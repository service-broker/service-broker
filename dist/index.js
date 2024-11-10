"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.subscriberRegistry = exports.providerRegistry = void 0;
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
const subscriber_1 = require("./subscriber");
const util_1 = require("./util");
const app = (0, util_1.immediate)(() => {
    const app = (0, express_1.default)();
    app.set("trust proxy", config_1.default.trustProxy);
    app.get("/", (req, res) => res.end("Healthcheck OK"));
    app.options("/:service", (0, cors_1.default)(config_1.default.corsOptions));
    app.post("/:service", config_1.default.nonProviderRateLimit ? (0, express_rate_limit_1.default)(config_1.default.nonProviderRateLimit) : [], (0, cors_1.default)(config_1.default.corsOptions), onHttpPost);
    return app;
});
const httpServer = (0, util_1.immediate)(() => {
    if (config_1.default.listeningPort) {
        const { listeningPort: port, listeningHost: host } = config_1.default;
        const server = http_1.default.createServer(app);
        server.listen(port, host, () => console.log(`HTTP listener started on ${host ?? "*"}:${port}`));
        return server;
    }
});
const httpsServer = (0, util_1.immediate)(() => {
    if (config_1.default.ssl) {
        const { port, host, certFile, keyFile } = config_1.default.ssl;
        const readCerts = () => ({
            cert: (0, fs_1.readFileSync)(certFile),
            key: (0, fs_1.readFileSync)(keyFile)
        });
        const server = https_1.default.createServer(readCerts(), app);
        server.listen(port, host, () => console.log(`HTTPS listener started on ${host ?? "*"}:${port}`));
        const timer = setInterval(() => server.setSecureContext(readCerts()), 24 * 3600 * 1000);
        server.once("close", () => clearInterval(timer));
        return server;
    }
});
const wsServer = (0, util_1.immediate)(() => {
    if (httpServer) {
        const server = new ws_1.WebSocketServer({ server: httpServer, verifyClient });
        server.on("connection", onConnection);
        return server;
    }
});
const wssServer = (0, util_1.immediate)(() => {
    if (httpsServer) {
        const server = new ws_1.WebSocketServer({ server: httpsServer, verifyClient });
        server.on("connection", onConnection);
        return server;
    }
});
const endpoints = {};
const providerRegistry = new provider_1.ProviderRegistry();
exports.providerRegistry = providerRegistry;
const subscriberRegistry = (0, subscriber_1.makeSubscriberRegistry)();
exports.subscriberRegistry = subscriberRegistry;
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
        //if topic then broadcast
        if (isPubSub(service)) {
            delete header.id;
            const subscribers = subscriberRegistry.find(service, capabilities);
            for (const { endpoint } of subscribers)
                endpoint.send({ header, payload });
            res.end();
            return;
        }
        //find providers
        const providers = providerRegistry.find(service, capabilities);
        if (!providers.length) {
            res.status(404).end("No provider " + service);
            return;
        }
        //send to random provider
        const endpointId = (0, util_1.generateId)();
        let promise = new Promise((fulfill, reject) => {
            pending[endpointId] = (res) => res.header.error ? reject(res.header.error) : fulfill(res);
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
        throw "remoteAddress is null";
    const xForwardedFor = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(/\s*,\s*/) : [];
    return xForwardedFor.concat(req.socket.remoteAddress.replace(/^::ffff:/, '')).slice(-1 - config_1.default.trustProxy)[0];
}
function verifyClient(info) {
    return config_1.default.corsOptions.origin.test(info.origin);
}
function isPubSub(serviceName) {
    return /^#/.test(serviceName);
}
function onConnection(ws, upreq) {
    const ip = getClientIp(upreq);
    const endpointId = (0, util_1.generateId)();
    const endpoint = endpoints[endpointId] = (0, endpoint_1.makeEndpoint)(endpointId, ws);
    const nonProviderRateLimiter = (0, util_1.immediate)(() => {
        if (config_1.default.nonProviderRateLimit) {
            const limiter = (0, util_1.makeRateLimiter)({
                tokensPerInterval: config_1.default.nonProviderRateLimit.limit,
                interval: config_1.default.nonProviderRateLimit.windowMs
            });
            return {
                apply() {
                    if (!limiter.tryRemoveTokens(1))
                        throw "RATE_LIMIT_EXCEEDED";
                }
            };
        }
    });
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
            if (nonProviderRateLimiter && !providerRegistry.endpoints.has(endpoint))
                nonProviderRateLimiter.apply();
            if (msg.header.to)
                handleForward(msg);
            else if (msg.header.service)
                handleServiceRequest(msg, ip);
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
                throw "Don't know what to do with message";
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
            else {
                console.error(ip, endpointId, String(err), msg.header);
            }
        }
    });
    ws.on("pong", () => endpoint.isAlive = true);
    ws.on("close", function () {
        delete endpoints[endpointId];
        providerRegistry.remove(endpoint);
        subscriberRegistry.remove(endpoint);
        for (const waiter of endpoint.waiters) {
            endpoints[waiter.endpointId]?.send({
                header: {
                    id: waiter.responseId,
                    type: "SbEndpointWaitResponse",
                    endpointId
                }
            });
        }
    });
    function handleForward(msg) {
        if (endpoints[msg.header.to]) {
            msg.header.from = endpointId;
            endpoints[msg.header.to].send(msg);
        }
        else if (pending[msg.header.to]) {
            pending[msg.header.to](msg);
        }
        else {
            throw "ENDPOINT_NOT_FOUND";
        }
    }
    function handleServiceRequest(msg, ip) {
        basicStats.inc(msg.header.method ? `${msg.header.service.name}/${msg.header.method}` : msg.header.service.name);
        msg.header.from = endpointId;
        msg.header.ip = ip;
        if (isPubSub(msg.header.service.name)) {
            const subscribers = subscriberRegistry.find(msg.header.service.name, msg.header.service.capabilities);
            for (const { endpoint } of subscribers)
                endpoint.send(msg);
        }
        else {
            const providers = providerRegistry.find(msg.header.service.name, msg.header.service.capabilities);
            if (providers.length)
                (0, util_1.pickRandom)(providers).endpoint.send(msg);
            else
                throw "NO_PROVIDER " + msg.header.service.name;
        }
    }
    function handleAdvertiseRequest(msg) {
        const { services, topics } = parseAdvertisedServices(msg.header.services);
        if (services.length > 0 && config_1.default.providerAuthToken && msg.header.authToken != config_1.default.providerAuthToken)
            throw "FORBIDDEN";
        providerRegistry.remove(endpoint);
        for (const service of services)
            providerRegistry.add(endpoint, service.name, service.capabilities, service.priority ?? 0, service.httpHeaders);
        subscriberRegistry.remove(endpoint);
        for (const topic of topics)
            subscriberRegistry.add(endpoint, topic.name, topic.capabilities);
        if (msg.header.id) {
            endpoint.send({
                header: {
                    id: msg.header.id,
                    type: "SbAdvertiseResponse"
                }
            });
        }
    }
    function parseAdvertisedServices(items) {
        const services = [];
        const topics = [];
        if (!Array.isArray(items))
            throw "BAD_REQUEST";
        for (const { name, capabilities, priority, httpHeaders } of items) {
            if (typeof name != "string")
                throw "BAD_REQUEST";
            if (typeof capabilities != "undefined" && !Array.isArray(capabilities))
                throw "BAD_REQUEST";
            if (isPubSub(name)) {
                topics.push({ name, capabilities });
            }
            else {
                if (typeof priority != "undefined" && typeof priority != "number")
                    throw "BAD_REQUEST";
                if (typeof httpHeaders != "undefined" && !Array.isArray(httpHeaders))
                    throw "BAD_REQUEST";
                services.push({ name, capabilities, priority, httpHeaders });
            }
        }
        return { services, topics };
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
            })),
            subscriberRegistry: subscriberRegistry.status(),
        };
        if (msg.header.id) {
            endpoint.send({
                header: {
                    id: msg.header.id,
                    type: "SbStatusResponse"
                },
                payload: JSON.stringify(status)
            });
        }
        else {
            console.log("numEndpoints:", status.numEndpoints);
            for (const entry of status.providerRegistry)
                console.log(entry.service, entry.providers);
            for (const entry of status.subscriberRegistry)
                console.log(entry.topic, entry.subscribers);
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
            throw "ENDPOINT_NOT_FOUND";
        if (target.waiters.find(x => x.endpointId == endpointId))
            throw "ALREADY_WAITING";
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
