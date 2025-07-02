import cors from "cors";
import express from "express";
import expressRateLimit from "express-rate-limit";
import { appendFile, readFileSync } from "fs";
import http from "http";
import https from "https";
import { WebSocketServer } from 'ws';
import config from "./config.js";
import { makeEndpoint } from "./endpoint.js";
import { ProviderRegistry } from "./provider.js";
import { makeSubscriberRegistry } from "./subscriber.js";
import { StatsCounter, generateId, getStream, immediate, makeRateLimiter, messageFromBuffer, messageFromString, pTimeout, pickRandom } from "./util.js";
const app = immediate(() => {
    const app = express();
    app.set("trust proxy", config.trustProxy);
    app.use(cors(config.corsOptions));
    app.get("/", (req, res) => res.end("Healthcheck OK"));
    app.post("/:service", config.nonProviderRateLimit ? expressRateLimit(config.nonProviderRateLimit) : [], onHttpPost);
    return app;
});
const httpServer = immediate(() => {
    if (config.listeningPort) {
        const { listeningPort: port, listeningHost: host } = config;
        const server = http.createServer(app);
        server.listen(port, host, () => console.log(`HTTP listener started on ${host ?? "*"}:${port}`));
        return server;
    }
});
const httpsServer = immediate(() => {
    if (config.ssl) {
        const { port, host, certFile, keyFile } = config.ssl;
        const readCerts = () => ({
            cert: readFileSync(certFile),
            key: readFileSync(keyFile)
        });
        const server = https.createServer(readCerts(), app);
        server.listen(port, host, () => console.log(`HTTPS listener started on ${host ?? "*"}:${port}`));
        const timer = setInterval(() => server.setSecureContext(readCerts()), 24 * 3600 * 1000);
        server.once("close", () => clearInterval(timer));
        return server;
    }
});
const wsServer = immediate(() => {
    if (httpServer) {
        const server = new WebSocketServer({ server: httpServer, verifyClient });
        server.on("connection", onConnection);
        return server;
    }
});
const wssServer = immediate(() => {
    if (httpsServer) {
        const server = new WebSocketServer({ server: httpsServer, verifyClient });
        server.on("connection", onConnection);
        return server;
    }
});
const endpoints = {};
const providerRegistry = new ProviderRegistry();
const subscriberRegistry = makeSubscriberRegistry();
const pending = {};
const basicStats = new StatsCounter();
async function onHttpPost(req, res) {
    try {
        const service = req.params.service;
        const capabilities = req.query.capabilities ? req.query.capabilities.split(',') : null;
        const header = JSON.parse(req.get("x-service-request-header") || "{}");
        const payload = await getStream(req)
            .then(buffer => req.is(config.textMimes) ? buffer.toString() : buffer);
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
            res.status(404).end("NO_PROVIDER " + service);
            return;
        }
        //send to random provider
        const endpointId = generateId();
        let promise = new Promise((fulfill, reject) => {
            pending[endpointId] = (res) => res.header.error ? reject(res.header.error) : fulfill(res);
        });
        promise = pTimeout(promise, Number(req.query.timeout || 15 * 1000));
        promise = promise.finally(() => delete pending[endpointId]);
        header.from = endpointId;
        if (!header.id)
            header.id = endpointId;
        const provider = pickRandom(providers);
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
    return xForwardedFor.concat(req.socket.remoteAddress.replace(/^::ffff:/, '')).slice(-1 - config.trustProxy)[0];
}
function verifyClient(info) {
    if (info.origin && config.corsOptions.origin instanceof RegExp) {
        return config.corsOptions.origin.test(info.origin);
    }
    else {
        return true;
    }
}
function isPubSub(serviceName) {
    return /^#/.test(serviceName);
}
function onConnection(ws, upreq) {
    const ip = getClientIp(upreq);
    const endpointId = generateId();
    const endpoint = endpoints[endpointId] = makeEndpoint(endpointId, ws);
    const nonProviderRateLimiter = immediate(() => {
        if (config.nonProviderRateLimit) {
            const limiter = makeRateLimiter({
                tokensPerInterval: config.nonProviderRateLimit.limit,
                interval: config.nonProviderRateLimit.windowMs
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
                msg = messageFromBuffer(data);
            else
                msg = messageFromString(data.toString());
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
                pickRandom(providers).endpoint.send(msg);
            else
                throw "NO_PROVIDER " + msg.header.service.name;
        }
    }
    function handleAdvertiseRequest(msg) {
        const { services, topics } = parseAdvertisedServices(msg.header.services);
        if (services.length > 0 && config.providerAuthToken && msg.header.authToken != config.providerAuthToken)
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
        appendFile(config.basicStats.file, `${now.getHours()}:${now.getMinutes()} ` + basicStats.toJson() + "\n", err => err && console.error(err));
        basicStats.clear();
    }, config.basicStats.interval),
    setInterval(() => {
        for (const endpoint of providerRegistry.endpoints)
            endpoint.keepAlive();
    }, config.providerKeepAlive),
    setInterval(() => {
        for (const id in endpoints)
            if (!providerRegistry.endpoints.has(endpoints[id]))
                endpoints[id].keepAlive();
    }, config.nonProviderKeepAlive)
];
process.on('uncaughtException', console.error);
function shutdown() {
    httpServer?.close();
    httpsServer?.close();
    timers.forEach(clearInterval);
}
//for testing
export { providerRegistry, shutdown, subscriberRegistry };
