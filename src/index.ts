import * as cors from "cors";
import * as express from "express";
import * as rateLimit from "express-rate-limit";
import { appendFile } from "fs";
import { createServer, IncomingMessage } from "http";
import { generate as generateId } from 'shortid';
import * as WebSocket from 'ws';
import config from "./config";
import { Counter } from "./stats";

const getStream = require("get-stream");
const pTimeout = require("p-timeout");
const pFinally = require("p-finally");

const basicStats = new Counter();


interface Message {
  header: any;
  payload?: string|Buffer;
}

class Endpoint {
  isAlive: boolean;
  waiters: {endpointId: string, responseId: number}[];
  constructor(public id: string, private ws: WebSocket) {
    this.isAlive = true;
    this.waiters = [];
  }
  send(msg: Message) {
    const headerStr = JSON.stringify(msg.header);
    if (msg.payload) {
      if (typeof msg.payload == "string") {
        this.ws.send(headerStr + '\n' + msg.payload);
      }
      else if (Buffer.isBuffer(msg.payload)) {
        const headerLen = Buffer.byteLength(headerStr);
        const tmp = Buffer.allocUnsafe(headerLen +1 +msg.payload.length);
        tmp.write(headerStr);
        tmp[headerLen] = 10;
        msg.payload.copy(tmp, headerLen+1);
        this.ws.send(tmp);
      }
      else throw new Error("Unexpected");
    }
    else this.ws.send(headerStr);
  }
  keepAlive() {
    if (!this.isAlive) return this.ws.terminate();
    this.isAlive = false;
    this.ws.ping();
  }
}

interface Provider {
  endpoint: Endpoint;
  capabilities: Set<string>;
  priority: number;
}

class ProviderRegistry {
  readonly registry: {[key: string]: Provider[]};
  readonly endpoints: Set<Endpoint>;
  constructor() {
    this.registry = {};
    this.endpoints = new Set<Endpoint>();
  }
  add(endpoint: Endpoint, name: string, capabilities: string[], priority: number) {
    const list = this.registry[name] || (this.registry[name] = []);
    //keep sorted in descending priority
    const index = list.findIndex(x => x.priority < priority);
    const provider: Provider = {
      endpoint,
      capabilities: capabilities && new Set(capabilities),
      priority
    };
    if (index != -1) list.splice(index, 0, provider);
    else list.push(provider);
    this.endpoints.add(endpoint);
  }
  remove(endpoint: Endpoint) {
    if (this.endpoints.has(endpoint)) {
      for (const name in this.registry) this.registry[name] = this.registry[name].filter(x => x.endpoint != endpoint);
      this.endpoints.delete(endpoint);
    }
  }
  find(name: string, requiredCapabilities: string[]): Provider[] {
    const list = this.registry[name];
    if (list) {
      const isCapable = (provider: Provider) => !provider.capabilities || requiredCapabilities.every(x => provider.capabilities.has(x));
      const capableProviders = !requiredCapabilities ? list : list.filter(isCapable);
      if (capableProviders.length) return capableProviders.filter(x => x.priority == capableProviders[0].priority);
      else return null;
    }
    else return null;
  }
}

interface Status {
  numEndpoints: number;
  providerRegistry: Array<{
    service: string,
    providers: Array<{
      endpointId: string,
      capabilities: string[],
      priority: number
    }>
  }>
}



const app = express();
const server = createServer(app);
const pending: {[key: string]: (res: Message) => void} = {};

app.set("trust proxy", config.trustProxy);
app.get("/", (req, res) => res.end("Healthcheck OK"));
app.options("/:service", cors(config.corsOptions));
app.post("/:service", config.rateLimit ? rateLimit(config.rateLimit) : [], cors(config.corsOptions), onHttpPost);

server.listen(config.listeningPort, () => console.log(`Service broker started on ${config.listeningPort}`));


async function onHttpPost(req: express.Request, res: express.Response) {
  try {
    const service = req.params.service;
    const capabilities = req.query.capabilities && (req.query.capabilities as string).split(',');
    const header = JSON.parse(req.get("x-service-request-header") || "{}");
    const payload = config.textMimes.some(x => !!req.is(x)) ? await getStream(req) : await getStream.buffer(req);

    if (!service) {
      res.status(400).end("Missing args");
      return;
    }

    //update stats
    basicStats.inc(header.method ? `${service}/${header.method}` : service);

    //find providers
    const providers = providerRegistry.find(service, capabilities);
    if (!providers) {
      res.status(404).end("No provider " + service);
      return;
    }

    //if topic then broadcast
    if (service.startsWith("#")) {
      delete header.id;
      providers.forEach(x => x.endpoint.send({header, payload}));
      res.end();
      return;
    }

    //send to random provider
    const endpointId = generateId();
    let promise = new Promise<Message>((fulfill, reject) => {
      pending[endpointId] = (res) => res.header.error ? reject(new Error(res.header.error)) : fulfill(res);
    })
    promise = pTimeout(promise, Number(req.query.timeout || 15*1000));
    promise = pFinally(promise, () => delete pending[endpointId]);

    header.from = endpointId;
    header.ip = getClientIp(req);
    if (!header.id) header.id = endpointId;
    if (req.get("content-type")) header.contentType = req.get("content-type");
    header.service = {name: service, capabilities};
    pickRandom(providers).endpoint.send({header, payload});
    const msg = await promise;

    //forward the response
    if (msg.header.contentType) {
      res.set("content-type", msg.header.contentType);
      delete msg.header.contentType;
    }
    res.set("x-service-response-header", JSON.stringify(msg.header));
    if (msg.payload) res.send(msg.payload);
    else res.end();
  }
  catch (err) {
    res.status(500).end(err.message);
  }
}

function getClientIp(req: IncomingMessage) {
  const xForwardedFor = req.headers['x-forwarded-for'] ? (<string>req.headers['x-forwarded-for']).split(/\s*,\s*/) : [];
  return xForwardedFor.concat(req.connection.remoteAddress.replace(/^::ffff:/, '')).slice(-1-config.trustProxy)[0];
}



const endpoints: {[key: string]: Endpoint} = {};
const providerRegistry = new ProviderRegistry();
const wss = new WebSocket.Server({
  server,
  verifyClient: function(info: {origin: string}) {
    return (<RegExp>config.corsOptions.origin).test(info.origin);
  }
})

wss.on("connection", function(ws: WebSocket, upreq) {
  const ip = getClientIp(upreq);
  const endpointId = generateId();
  const endpoint = endpoints[endpointId] = new Endpoint(endpointId, ws);

  ws.on("message", function(data: WebSocket.Data) {
    let msg: Message;
    try {
      if (typeof data == "string") msg = messageFromString(data);
      else if (Buffer.isBuffer(data)) msg = messageFromBuffer(data);
      else throw new Error("Message is not a string or Buffer");
    }
    catch (err) {
      console.error(err.message);
      return;
    }
    try {
      if (msg.header.to) handleForward(msg);
      else if (msg.header.service) {
        msg.header.ip = ip;
        handleServiceRequest(msg);
      }
      else if (msg.header.type == "SbAdvertiseRequest") handleAdvertiseRequest(msg);
      else if (msg.header.type == "SbStatusRequest") handleStatusRequest(msg);
      else if (msg.header.type == "SbEndpointStatusRequest") handleEndpointStatusRequest(msg);
      else if (msg.header.type == "SbEndpointWaitRequest") handleEndpointWaitRequest(msg);
      else throw new Error("Don't know what to do with message");
    }
    catch (err) {
      if (msg.header.id) endpoint.send({header: {id: msg.header.id, error: err.message}});
      else console.error(err.message, msg.header);
    }
  })

  ws.on("pong", () => endpoint.isAlive = true);

  ws.on("close", function() {
    delete endpoints[endpointId];
    providerRegistry.remove(endpoint);
    for (const waiter of endpoint.waiters) endpoints[waiter.endpointId]?.send({header: {id: waiter.responseId, type: "SbEndpointWaitResponse", endpointId}});
  })

  function handleForward(msg: Message) {
    if (endpoints[msg.header.to]) {
      msg.header.from = endpointId;
      endpoints[msg.header.to].send(msg);
    }
    else if (pending[msg.header.to]) {
      pending[msg.header.to](msg);
    }
    else throw new Error("Destination endpoint not found");
  }

  function handleServiceRequest(msg: Message) {
    basicStats.inc(msg.header.method ? `${msg.header.service.name}/${msg.header.method}` : msg.header.service.name);
    const providers = providerRegistry.find(msg.header.service.name, msg.header.service.capabilities);
    if (providers) {
      msg.header.from = endpointId;
      if (msg.header.service.name.startsWith("#")) providers.forEach(x => x.endpoint.send(msg));
      else pickRandom(providers).endpoint.send(msg);
    }
    else throw new Error("No provider " + msg.header.service.name);
  }

  function handleAdvertiseRequest(msg: Message) {
    providerRegistry.remove(endpoint);
    if (msg.header.services) {
      for (const service of msg.header.services) providerRegistry.add(endpoint, service.name, service.capabilities, service.priority);
    }
    if (msg.header.id) endpoint.send({header: {id: msg.header.id, type: "SbAdvertiseResponse"}});
  }

  function handleStatusRequest(msg: Message) {
    const status: Status = {
      numEndpoints: Object.keys(endpoints).length,
      providerRegistry: Object.keys(providerRegistry.registry).map(name => ({
        service: name,
        providers: providerRegistry.registry[name].map(provider => ({
          endpointId: provider.endpoint.id,
          capabilities: provider.capabilities && Array.from(provider.capabilities),
          priority: provider.priority
        }))
      }))
    }
    if (msg.header.id) endpoint.send({header: {id: msg.header.id, type: "SbStatusResponse"}, payload: JSON.stringify(status)});
    else {
      console.log("numEndpoints:", status.numEndpoints);
      for (const entry of status.providerRegistry)
        console.log(entry.service, entry.providers);
    }
  }

  function handleEndpointStatusRequest(msg: Message) {
    endpoint.send({
      header: {
        id: msg.header.id,
        type: "SbEndpointStatusResponse",
        endpointStatuses: msg.header.endpointIds.map((id: string) => endpoints[id] != null)
      }
    })
  }

  function handleEndpointWaitRequest(msg: Message) {
    const target = endpoints[msg.header.endpointId];
    if (!target) throw new Error("NOT_FOUND");
    if (target.waiters.find(x => x.endpointId == endpointId)) throw new Error("ALREADY_WAITING");
    target.waiters.push({endpointId, responseId: msg.header.id});
  }
})



const timers = [
  setInterval(() => {
    const now = new Date();
    appendFile(config.basicStats.file, `${now.getHours()}:${now.getMinutes()} ` + basicStats.toJson() + "\n", err => err && console.error(err));
    basicStats.clear();
  },
  config.basicStats.interval),

  setInterval(() => {
    for (const endpoint of providerRegistry.endpoints) endpoint.keepAlive();
  },
  config.providerKeepAlive),

  setInterval(() => {
    for (const id in endpoints) if (!providerRegistry.endpoints.has(endpoints[id])) endpoints[id].keepAlive();
  },
  config.nonProviderKeepAlive)
]

process.on('uncaughtException', console.error);



function messageFromString(str: string): Message {
  if (str[0] != '{') throw new Error("Message doesn't have JSON header");
  const index = str.indexOf('\n');
  const headerStr = (index != -1) ? str.slice(0,index) : str;
  const payload = (index != -1) ? str.slice(index+1) : undefined;
  let header: any;
  try {
    header = JSON.parse(headerStr);
  }
  catch (err) {
    throw new Error("Failed to parse message header");
  }
  return {header, payload};
}

function messageFromBuffer(buf: Buffer): Message {
  if (buf[0] != 123) throw new Error("Message doesn't have JSON header");
  const index = buf.indexOf('\n');
  const headerStr = (index != -1) ? buf.slice(0,index).toString() : buf.toString();
  const payload = (index != -1) ? buf.slice(index+1) : undefined;
  let header: any;
  try {
    header = JSON.parse(headerStr);
  }
  catch (err) {
    throw new Error("Failed to parse message header");
  }
  return {header, payload};
}

function pickRandom<T>(list: Array<T>): T {
  const randomIndex = Math.floor(Math.random() *list.length);
  return list[randomIndex];
}

function shutdown() {
  server.close();
  timers.forEach(clearInterval);
}
