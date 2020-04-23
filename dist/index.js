"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const cors = require("cors");
const express = require("express");
const rateLimit = require("express-rate-limit");
const fs_1 = require("fs");
const http_1 = require("http");
const shortid_1 = require("shortid");
const WebSocket = require("ws");
const config_1 = require("./config");
const stats_1 = require("./stats");
const getStream = require("get-stream");
const pTimeout = require("p-timeout");
const pFinally = require("p-finally");
const basicStats = new stats_1.Counter();
class Endpoint {
    constructor(id, ws) {
        this.id = id;
        this.ws = ws;
        this.isAlive = true;
        this.waiters = [];
    }
    send(msg) {
        const headerStr = JSON.stringify(msg.header);
        if (msg.payload) {
            if (typeof msg.payload == "string") {
                this.ws.send(headerStr + '\n' + msg.payload);
            }
            else if (Buffer.isBuffer(msg.payload)) {
                const headerLen = Buffer.byteLength(headerStr);
                const tmp = Buffer.allocUnsafe(headerLen + 1 + msg.payload.length);
                tmp.write(headerStr);
                tmp[headerLen] = 10;
                msg.payload.copy(tmp, headerLen + 1);
                this.ws.send(tmp);
            }
            else
                throw new Error("Unexpected");
        }
        else
            this.ws.send(headerStr);
    }
    keepAlive() {
        if (!this.isAlive)
            return this.ws.terminate();
        this.isAlive = false;
        this.ws.ping();
    }
}
class ProviderRegistry {
    constructor() {
        this.registry = {};
        this.endpoints = new Set();
    }
    add(endpoint, name, capabilities, priority) {
        const list = this.registry[name] || (this.registry[name] = []);
        //keep sorted in descending priority
        const index = list.findIndex(x => x.priority < priority);
        const provider = {
            endpoint,
            capabilities: capabilities && new Set(capabilities),
            priority
        };
        if (index != -1)
            list.splice(index, 0, provider);
        else
            list.push(provider);
        this.endpoints.add(endpoint);
    }
    remove(endpoint) {
        if (this.endpoints.has(endpoint)) {
            for (const name in this.registry)
                this.registry[name] = this.registry[name].filter(x => x.endpoint != endpoint);
            this.endpoints.delete(endpoint);
        }
    }
    find(name, requiredCapabilities) {
        const list = this.registry[name];
        if (list) {
            const isCapable = (provider) => !provider.capabilities || requiredCapabilities.every(x => provider.capabilities.has(x));
            const capableProviders = !requiredCapabilities ? list : list.filter(isCapable);
            if (capableProviders.length)
                return capableProviders.filter(x => x.priority == capableProviders[0].priority);
            else
                return null;
        }
        else
            return null;
    }
}
const app = express();
const server = http_1.createServer(app);
const pending = {};
app.set("trust proxy", config_1.default.trustProxy);
app.get("/", (req, res) => res.end("Healthcheck OK"));
app.options("/:service", cors(config_1.default.corsOptions));
app.post("/:service", config_1.default.rateLimit ? rateLimit(config_1.default.rateLimit) : [], cors(config_1.default.corsOptions), onHttpPost);
server.listen(config_1.default.listeningPort, () => console.log(`Service broker started on ${config_1.default.listeningPort}`));
function onHttpPost(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const service = req.params.service;
            const capabilities = req.query.capabilities && req.query.capabilities.split(',');
            const header = JSON.parse(req.get("x-service-request-header") || "{}");
            const payload = config_1.default.textMimes.some(x => !!req.is(x)) ? yield getStream(req) : yield getStream.buffer(req);
            if (!service) {
                res.status(400).end("Missing args");
                return;
            }
            //update stats
            basicStats.inc(header.method ? `${service}/${header.method}` : service);
            //find providers
            const providers = providerRegistry.find(service, capabilities);
            if (!providers) {
                res.status(404).end("No provider");
                return;
            }
            //if topic then broadcast
            if (service.startsWith("#")) {
                delete header.id;
                providers.forEach(x => x.endpoint.send({ header, payload }));
                res.end();
                return;
            }
            //send to random provider
            const endpointId = shortid_1.generate();
            let promise = new Promise((fulfill, reject) => {
                pending[endpointId] = (res) => res.header.error ? reject(new Error(res.header.error)) : fulfill(res);
            });
            promise = pTimeout(promise, Number(req.query.timeout || 15 * 1000));
            promise = pFinally(promise, () => delete pending[endpointId]);
            header.from = endpointId;
            header.ip = getClientIp(req);
            if (!header.id)
                header.id = endpointId;
            if (req.get("content-type"))
                header.contentType = req.get("content-type");
            header.service = { name: service, capabilities };
            pickRandom(providers).endpoint.send({ header, payload });
            const msg = yield promise;
            //forward the response
            if (msg.header.contentType) {
                res.set("content-type", msg.header.contentType);
                delete msg.header.contentType;
            }
            res.set("x-service-response-header", JSON.stringify(msg.header));
            if (msg.payload)
                res.send(msg.payload);
            else
                res.end();
        }
        catch (err) {
            res.status(500).end(err.message);
        }
    });
}
function getClientIp(req) {
    const xForwardedFor = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(/\s*,\s*/) : [];
    return xForwardedFor.concat(req.connection.remoteAddress.replace(/^::ffff:/, '')).slice(-1 - config_1.default.trustProxy)[0];
}
const endpoints = {};
const providerRegistry = new ProviderRegistry();
const wss = new WebSocket.Server({
    server,
    verifyClient: function (info) {
        return config_1.default.corsOptions.origin.test(info.origin);
    }
});
wss.on("connection", function (ws, upreq) {
    const ip = getClientIp(upreq);
    const endpointId = shortid_1.generate();
    const endpoint = endpoints[endpointId] = new Endpoint(endpointId, ws);
    ws.on("message", function (data) {
        let msg;
        try {
            if (typeof data == "string")
                msg = messageFromString(data);
            else if (Buffer.isBuffer(data))
                msg = messageFromBuffer(data);
            else
                throw new Error("Message is not a string or Buffer");
        }
        catch (err) {
            console.error(err.message);
            return;
        }
        if (msg.header.service)
            msg.header.ip = ip;
        try {
            if (msg.header.to)
                handleForward(msg);
            else if (msg.header.service)
                handleServiceRequest(msg);
            else if (msg.header.type == "SbAdvertiseRequest")
                handleAdvertiseRequest(msg);
            else if (msg.header.type == "SbStatusRequest")
                handleStatusRequest(msg);
            else if (msg.header.type == "SbEndpointStatusRequest")
                handleEndpointStatusRequest(msg);
            else if (msg.header.type == "SbEndpointWaitRequest")
                handleEndpointWaitRequest(msg);
            else
                throw new Error("Don't know what to do with message");
        }
        catch (err) {
            if (msg.header.id)
                endpoint.send({ header: { id: msg.header.id, error: err.message } });
            else
                console.error(err.message, msg.header);
        }
    });
    ws.on("pong", () => endpoint.isAlive = true);
    ws.on("close", function () {
        var _a;
        delete endpoints[endpointId];
        providerRegistry.remove(endpoint);
        for (const waiter of endpoint.waiters)
            (_a = endpoints[waiter.endpointId]) === null || _a === void 0 ? void 0 : _a.send({ header: { id: waiter.responseId, type: "SbEndpointWaitResponse" } });
    });
    function handleForward(msg) {
        if (endpoints[msg.header.to]) {
            msg.header.from = endpointId;
            endpoints[msg.header.to].send(msg);
        }
        else if (pending[msg.header.to]) {
            pending[msg.header.to](msg);
        }
        else
            throw new Error("Destination endpoint not found");
    }
    function handleServiceRequest(msg) {
        basicStats.inc(msg.header.method ? `${msg.header.service.name}/${msg.header.method}` : msg.header.service.name);
        const providers = providerRegistry.find(msg.header.service.name, msg.header.service.capabilities);
        if (providers) {
            msg.header.from = endpointId;
            if (msg.header.service.name.startsWith("#"))
                providers.forEach(x => x.endpoint.send(msg));
            else
                pickRandom(providers).endpoint.send(msg);
        }
        else
            throw new Error("No provider");
    }
    function handleAdvertiseRequest(msg) {
        providerRegistry.remove(endpoint);
        if (msg.header.services) {
            for (const service of msg.header.services)
                providerRegistry.add(endpoint, service.name, service.capabilities, service.priority);
        }
        if (msg.header.id)
            endpoint.send({ header: { id: msg.header.id, type: "SbAdvertiseResponse" } });
    }
    function handleStatusRequest(msg) {
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
        };
        if (msg.header.id)
            endpoint.send({ header: { id: msg.header.id, type: "SbStatusResponse" }, payload: JSON.stringify(status) });
        else {
            console.log("numEndpoints:", status.numEndpoints);
            for (const entry of status.providerRegistry)
                console.log(entry.service, entry.providers);
        }
    }
    function handleEndpointStatusRequest(msg) {
        endpoint.send({
            header: {
                id: msg.header.id,
                type: "SbEndpointStatusResponse",
                endpointStatuses: msg.header.endpointIds.map((id) => endpoints[id] != null)
            }
        });
    }
    function handleEndpointWaitRequest(msg) {
        const target = endpoints[msg.header.endpointId];
        if (!target)
            throw new Error("NOT_FOUND");
        if (target.waiters.find(x => x.endpointId == endpointId))
            throw new Error("ALREADY_WAITING");
        target.waiters.push({ endpointId, responseId: msg.header.id });
    }
});
const timers = [
    setInterval(() => {
        const now = new Date();
        fs_1.appendFile(config_1.default.basicStats.file, `${now.getHours()}:${now.getMinutes()} ` + basicStats.toJson() + "\n", err => err && console.error(err));
        basicStats.clear();
    }, config_1.default.basicStats.interval),
    setInterval(() => {
        for (const endpoint of providerRegistry.endpoints)
            endpoint.keepAlive();
    }, config_1.default.providerKeepAlive),
    setInterval(() => {
        for (const id in endpoints)
            if (!providerRegistry.endpoints.has(endpoints[id]))
                endpoints[id].keepAlive();
    }, config_1.default.nonProviderKeepAlive)
];
process.on('uncaughtException', console.error);
function messageFromString(str) {
    if (str[0] != '{')
        throw new Error("Message doesn't have JSON header");
    const index = str.indexOf('\n');
    const headerStr = (index != -1) ? str.slice(0, index) : str;
    const payload = (index != -1) ? str.slice(index + 1) : undefined;
    let header;
    try {
        header = JSON.parse(headerStr);
    }
    catch (err) {
        throw new Error("Failed to parse message header");
    }
    return { header, payload };
}
function messageFromBuffer(buf) {
    if (buf[0] != 123)
        throw new Error("Message doesn't have JSON header");
    const index = buf.indexOf('\n');
    const headerStr = (index != -1) ? buf.slice(0, index).toString() : buf.toString();
    const payload = (index != -1) ? buf.slice(index + 1) : undefined;
    let header;
    try {
        header = JSON.parse(headerStr);
    }
    catch (err) {
        throw new Error("Failed to parse message header");
    }
    return { header, payload };
}
function pickRandom(list) {
    const randomIndex = Math.floor(Math.random() * list.length);
    return list[randomIndex];
}
function shutdown() {
    server.close();
    timers.forEach(clearInterval);
}
