"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.providerRegistry = void 0;
exports.shutdown = shutdown;
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const fs_1 = require("fs");
const http_1 = __importDefault(require("http"));
const https_1 = __importDefault(require("https"));
const ws_1 = require("ws");
const config_1 = __importDefault(require("./config"));
const endpoint_1 = require("./endpoint");
const provider_1 = require("./provider");
const stats_1 = require("./stats");
const util_1 = require("./util");
const app = (function () {
    const app = (0, express_1.default)();
    app.set("trust proxy", config_1.default.trustProxy);
    app.get("/", (req, res) => res.end("Healthcheck OK"));
    app.options("/:service", (0, cors_1.default)(config_1.default.corsOptions));
    app.post("/:service", config_1.default.rateLimit ? (0, express_rate_limit_1.default)(config_1.default.rateLimit) : [], (0, cors_1.default)(config_1.default.corsOptions), onHttpPost);
    return app;
})();
const httpServer = config_1.default.listeningPort == undefined ? undefined : (function () {
    const server = http_1.default.createServer(app);
    server.listen(config_1.default.listeningPort, () => console.log(`HTTP listener started on ${config_1.default.listeningPort}`));
    return server;
})();
const httpsServer = config_1.default.ssl && (function () {
    const { port, certFile, keyFile } = config_1.default.ssl;
    const readCerts = () => ({
        cert: (0, fs_1.readFileSync)(certFile),
        key: (0, fs_1.readFileSync)(keyFile)
    });
    const server = https_1.default.createServer(readCerts(), app);
    server.listen(port, () => console.log(`HTTPS listener started on ${port}`));
    const timer = setInterval(() => server.setSecureContext(readCerts()), 24 * 3600 * 1000);
    server.once("close", () => clearInterval(timer));
    return server;
})();
const wsServer = httpServer && (function () {
    const server = new ws_1.WebSocketServer({ server: httpServer, verifyClient });
    server.on("connection", onConnection);
    return server;
})();
const wssServer = httpsServer && (function () {
    const server = new ws_1.WebSocketServer({ server: httpsServer, verifyClient });
    server.on("connection", onConnection);
    return server;
})();
const endpoints = {};
const providerRegistry = new provider_1.ProviderRegistry();
exports.providerRegistry = providerRegistry;
const pending = {};
const basicStats = new stats_1.Counter();
async function onHttpPost(req, res) {
    try {
        const service = req.params.service;
        const capabilities = req.query.capabilities ? req.query.capabilities.split(',') : null;
        const header = JSON.parse(req.get("x-service-request-header") || "{}");
        const payload = await (0, util_1.getStream)(req)
            .then(buffer => req.is(config_1.default.textMimes) ? buffer.toString() : buffer);
        if (!service) {
            res.status(400).end("Missing args");
            return;
        }
        header.service = { name: service, capabilities };
        header.ip = getClientIp(req);
        if (req.get("content-type"))
            header.contentType = req.get("content-type");
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
            providers.forEach(x => x.endpoint.send({ header, payload }));
            res.end();
            return;
        }
        //send to random provider
        const endpointId = (0, util_1.generateId)();
        let promise = new Promise((fulfill, reject) => {
            pending[endpointId] = (res) => res.header.error ? reject(new Error(res.header.error)) : fulfill(res);
        });
        promise = (0, util_1.pTimeout)(promise, Number(req.query.timeout || 15 * 1000));
        promise = promise.finally(() => delete pending[endpointId]);
        header.from = endpointId;
        if (!header.id)
            header.id = endpointId;
        const provider = (0, util_1.pickRandom)(providers);
        if (provider.httpHeaders) {
            header.httpHeaders = {};
            for (const name of provider.httpHeaders)
                header.httpHeaders[name] = req.get(name);
        }
        provider.endpoint.send({ header, payload });
        const msg = await promise;
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
        res.status(500).end(err instanceof Error ? err.message : String(err));
    }
}
function getClientIp(req) {
    if (!req.socket.remoteAddress)
        throw new Error("remoteAddress is null");
    const xForwardedFor = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(/\s*,\s*/) : [];
    return xForwardedFor.concat(req.socket.remoteAddress.replace(/^::ffff:/, '')).slice(-1 - config_1.default.trustProxy)[0];
}
function verifyClient(info) {
    return config_1.default.corsOptions.origin.test(info.origin);
}
function onConnection(ws, upreq) {
    const ip = getClientIp(upreq);
    const endpointId = (0, util_1.generateId)();
    const endpoint = endpoints[endpointId] = (0, endpoint_1.makeEndpoint)(endpointId, ws);
    ws.on("message", function (data, isBinary) {
        let msg;
        try {
            if (isBinary)
                msg = (0, util_1.messageFromBuffer)(data);
            else
                msg = (0, util_1.messageFromString)(data.toString());
        }
        catch (err) {
            console.error(String(err));
            return;
        }
        try {
            if (msg.header.to)
                handleForward(msg);
            else if (msg.header.service) {
                msg.header.ip = ip;
                handleServiceRequest(msg);
            }
            else if (msg.header.type == "SbAdvertiseRequest")
                handleAdvertiseRequest(msg);
            else if (msg.header.type == "SbStatusRequest")
                handleStatusRequest(msg);
            else if (msg.header.type == "SbEndpointStatusRequest")
                handleEndpointStatusRequest(msg);
            else if (msg.header.type == "SbEndpointWaitRequest")
                handleEndpointWaitRequest(msg);
            else if (msg.header.type == "SbCleanupRequest")
                handleCleanupRequest(msg);
            else
                throw new Error("Don't know what to do with message");
        }
        catch (err) {
            if (msg.header.id) {
                endpoint.send({
                    header: {
                        id: msg.header.id,
                        error: err instanceof Error ? err.message : String(err)
                    }
                });
            }
            else
                console.error(String(err), msg.header);
        }
    });
    ws.on("pong", () => endpoint.isAlive = true);
    ws.on("close", function () {
        delete endpoints[endpointId];
        providerRegistry.remove(endpoint);
        for (const waiter of endpoint.waiters)
            endpoints[waiter.endpointId]?.send({ header: { id: waiter.responseId, type: "SbEndpointWaitResponse", endpointId } });
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
                (0, util_1.pickRandom)(providers).endpoint.send(msg);
        }
        else
            throw new Error("No provider " + msg.header.service.name);
    }
    function handleAdvertiseRequest(msg) {
        providerRegistry.remove(endpoint);
        if (msg.header.services) {
            for (const service of msg.header.services)
                providerRegistry.add(endpoint, service.name, service.capabilities, service.priority, service.httpHeaders);
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
    function handleCleanupRequest(msg) {
        providerRegistry.cleanup();
    }
}
const timers = [
    setInterval(() => {
        const now = new Date();
        (0, fs_1.appendFile)(config_1.default.basicStats.file, `${now.getHours()}:${now.getMinutes()} ` + basicStats.toJson() + "\n", err => err && console.error(err));
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
function shutdown() {
    httpServer?.close();
    httpsServer?.close();
    timers.forEach(clearInterval);
}
