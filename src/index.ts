import cors from "cors";
import express from "express";
import expressRateLimit from "express-rate-limit";
import { appendFile, readFileSync } from "fs";
import http from "http";
import https from "https";
import WebSocket, { WebSocketServer } from 'ws';
import config from "./config";
import { Endpoint, Message, makeEndpoint } from "./endpoint";
import { ProviderRegistry } from "./provider";
import { Counter } from "./stats";
import { generateId, getStream, immediate, makeRateLimiter, messageFromBuffer, messageFromString, pTimeout, pickRandom } from "./util";


const app = immediate(() => {
  const app = express()
  app.set("trust proxy", config.trustProxy);
  app.get("/", (req, res) => res.end("Healthcheck OK"));
  app.options("/:service", cors(config.corsOptions) as express.RequestHandler);
  app.post("/:service", config.serviceRequestRateLimit ? expressRateLimit(config.serviceRequestRateLimit) : [], cors(config.corsOptions), onHttpPost);
  return app
})

const httpServer = immediate(() => {
  if (config.listeningPort) {
    const {listeningPort: port, listeningHost: host} = config
    const server = http.createServer(app)
    server.listen(port, host, () => console.log(`HTTP listener started on ${host ?? "*"}:${port}`))
    return server
  }
})

const httpsServer = immediate(() => {
  if (config.ssl) {
    const {port, host, certFile, keyFile} = config.ssl
    const readCerts = () => ({
      cert: readFileSync(certFile),
      key: readFileSync(keyFile)
    })
    const server = https.createServer(readCerts(), app)
    server.listen(port, host, () => console.log(`HTTPS listener started on ${host ?? "*"}:${port}`))
    const timer = setInterval(() => server.setSecureContext(readCerts()), 24*3600*1000)
    server.once("close", () => clearInterval(timer))
    return server
  }
})

const wsServer = immediate(() => {
  if (httpServer) {
    const server = new WebSocketServer({server: httpServer, verifyClient})
    server.on("connection", onConnection)
    return server
  }
})

const wssServer = immediate(() => {
  if (httpsServer) {
    const server = new WebSocketServer({server: httpsServer, verifyClient})
    server.on("connection", onConnection)
    return server
  }
})

const endpoints: {[key: string]: Endpoint} = {};
const providerRegistry = new ProviderRegistry();
const pending: {[key: string]: (res: Message) => void} = {};
const basicStats = new Counter()



async function onHttpPost(req: express.Request, res: express.Response) {
  try {
    const service = req.params.service;
    const capabilities = req.query.capabilities ? (req.query.capabilities as string).split(',') : null;
    const header = JSON.parse(req.get("x-service-request-header") || "{}");
    const payload = await getStream(req)
      .then(buffer => req.is(config.textMimes) ? buffer.toString() : buffer)

    if (!service) {
      res.status(400).end("Missing args");
      return;
    }

    header.service = {name: service, capabilities};
    header.ip = getClientIp(req);
    if (req.get("content-type")) header.contentType = req.get("content-type");

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
      pending[endpointId] = (res) => res.header.error ? reject(res.header.error) : fulfill(res);
    })
    promise = pTimeout(promise, Number(req.query.timeout || 15*1000));
    promise = promise.finally(() => delete pending[endpointId]);

    header.from = endpointId;
    if (!header.id) header.id = endpointId;

    const provider = pickRandom(providers);
    if (provider.httpHeaders) {
      header.httpHeaders = {};
      for (const name of provider.httpHeaders) header.httpHeaders[name] = req.get(name);
    }
    provider.endpoint.send({header, payload});
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
    res.status(500).end(err instanceof Error ? err.message : String(err));
  }
}

function getClientIp(req: http.IncomingMessage) {
  if (!req.socket.remoteAddress) throw "remoteAddress is null"
  const xForwardedFor = req.headers['x-forwarded-for'] ? (<string>req.headers['x-forwarded-for']).split(/\s*,\s*/) : [];
  return xForwardedFor.concat(req.socket.remoteAddress.replace(/^::ffff:/, '')).slice(-1-config.trustProxy)[0];
}



function verifyClient(info: {origin: string}) {
  return (<RegExp>config.corsOptions.origin).test(info.origin);
}

function onConnection(ws: WebSocket, upreq: http.IncomingMessage) {
  const ip = getClientIp(upreq);
  const endpointId = generateId();
  const endpoint = endpoints[endpointId] = makeEndpoint(endpointId, ws)

  const serviceRequestRateLimiter = immediate(() => {
    if (config.serviceRequestRateLimit) {
      const limiter = makeRateLimiter({
        tokensPerInterval: config.serviceRequestRateLimit.limit,
        interval: config.serviceRequestRateLimit.windowMs
      })
      return {
        apply() {
          if (!limiter.tryRemoveTokens(1)) throw "RATE_LIMIT_EXCEEDED"
        }
      }
    }
  })

  ws.on("message", function(data: Buffer, isBinary: boolean) {
    let msg: Message;
    try {
      if (isBinary) msg = messageFromBuffer(data);
      else msg = messageFromString(data.toString());
    }
    catch (err) {
      console.error(String(err));
      return;
    }
    try {
      if (msg.header.to) handleForward(msg);
      else if (msg.header.service) handleServiceRequest(msg, ip)
      else if (msg.header.type == "SbAdvertiseRequest") handleAdvertiseRequest(msg);
      else if (msg.header.type == "SbStatusRequest") handleStatusRequest(msg);
      else if (msg.header.type == "SbEndpointStatusRequest") handleEndpointStatusRequest(msg);
      else if (msg.header.type == "SbEndpointWaitRequest") handleEndpointWaitRequest(msg);
      else if (msg.header.type == "SbCleanupRequest") handleCleanupRequest(msg);
      else throw "Don't know what to do with message"
    }
    catch (err) {
      if (msg.header.id) {
        endpoint.send({
          header: {
            id: msg.header.id,
            error: err instanceof Error ? err.message : String(err)
          }
        })
      }
      else {
        console.error(ip, endpointId, String(err), msg.header);
      }
    }
  })

  ws.on("pong", () => endpoint.isAlive = true);

  ws.on("close", function() {
    delete endpoints[endpointId];
    providerRegistry.remove(endpoint);
    for (const waiter of endpoint.waiters) {
      endpoints[waiter.endpointId]?.send({
        header: {
          id: waiter.responseId,
          type: "SbEndpointWaitResponse",
          endpointId
        }
      })
    }
  })

  function handleForward(msg: Message) {
    if (endpoints[msg.header.to]) {
      //if this is a service request, apply rate limit
      if (msg.header.service && !providerRegistry.endpoints.has(endpoint)) serviceRequestRateLimiter?.apply()

      msg.header.from = endpointId;
      endpoints[msg.header.to].send(msg);
    }
    else if (pending[msg.header.to]) {
      pending[msg.header.to](msg);
    }
    else {
      throw "ENDPOINT_NOT_FOUND"
    }
  }

  function handleServiceRequest(msg: Message, ip: string) {
    if (!providerRegistry.endpoints.has(endpoint)) serviceRequestRateLimiter?.apply()
    basicStats.inc(msg.header.method ? `${msg.header.service.name}/${msg.header.method}` : msg.header.service.name);

    msg.header.ip = ip;
    const providers = providerRegistry.find(msg.header.service.name, msg.header.service.capabilities);
    if (providers) {
      msg.header.from = endpointId;
      if (msg.header.service.name.startsWith("#")) providers.forEach(x => x.endpoint.send(msg));
      else pickRandom(providers).endpoint.send(msg);
    }
    else {
      throw "NO_PROVIDER " + msg.header.service.name
    }
  }

  function handleAdvertiseRequest(msg: Message) {
    if (config.providerAuthToken
      && msg.header.services?.some((service: any) => !/^#/.test(service.name))
      && msg.header.authToken != config.providerAuthToken
    ) {
      throw "FORBIDDEN"
    }
    providerRegistry.remove(endpoint);
    if (msg.header.services) {
      for (const service of msg.header.services)
        providerRegistry.add(endpoint, service.name, service.capabilities, service.priority, service.httpHeaders)
    }
    if (msg.header.id) {
      endpoint.send({
        header: {
          id: msg.header.id,
          type: "SbAdvertiseResponse"
        }
      })
    }
  }

  function handleStatusRequest(msg: Message) {
    const status = {
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
    if (msg.header.id) {
      endpoint.send({
        header: {
          id: msg.header.id,
          type: "SbStatusResponse"
        },
        payload: JSON.stringify(status)
      })
    }
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
    if (!target) throw "ENDPOINT_NOT_FOUND"
    if (target.waiters.find(x => x.endpointId == endpointId)) throw "ALREADY_WAITING"
    target.waiters.push({endpointId, responseId: msg.header.id});
  }

  function handleCleanupRequest(msg: Message) {
    providerRegistry.cleanup();
  }
}



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

function shutdown() {
  httpServer?.close()
  httpsServer?.close()
  timers.forEach(clearInterval);
}

//for testing
export {
  providerRegistry,
  shutdown
}
