import * as ws from "@service-broker/websocket";
import cors from "cors";
import express from "express";
import expressRateLimit from "express-rate-limit";
import { readFileSync } from "fs";
import { appendFile } from "fs/promises";
import http from "http";
import https from "https";
import { RateLimiterMemory } from "rate-limiter-flexible";
import * as rxjs from "rxjs";
import config from "./config.js";
import { makeEndpoint } from "./endpoint.js";
import * as providerRegistry from "./provider.js";
import * as subscriberRegistry from "./subscriber.js";
import { StatsCounter, assertRecord, generateId, getClientIp, getStream, immediate, pTimeout, pickRandom } from "./util.js";
const shutdown$ = new rxjs.Subject();
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
const endpoints = new Map();
const pendingResponse = new Map();
const basicStats = new StatsCounter();
const nonProviderRateLimiter = config.nonProviderRateLimit ? new RateLimiterMemory({
    points: config.nonProviderRateLimit.limit,
    duration: config.nonProviderRateLimit.windowMs / 1000
}) : null;
rxjs.merge(rxjs.iif(() => httpServer != null, makeWebSocketServer(httpServer), rxjs.EMPTY), rxjs.iif(() => httpsServer != null, makeWebSocketServer(httpsServer), rxjs.EMPTY), rxjs.interval(config.basicStats.interval).pipe(rxjs.tap(() => {
    const now = new Date();
    appendFile(config.basicStats.file, `${now.getHours()}:${now.getMinutes()} ` + basicStats.toJson() + "\n")
        .then(() => basicStats.clear())
        .catch(console.error);
})), rxjs.fromEvent(process, 'uncaughtException').pipe(rxjs.tap(console.error))).pipe(rxjs.takeUntil(shutdown$), rxjs.finalize(() => {
    httpServer?.close();
    httpsServer?.close();
})).subscribe({
    error: console.error
});
async function onHttpPost(req, res) {
    try {
        const service = req.params.service;
        const capabilities = req.query.capabilities ? req.query.capabilities.split(',') : undefined;
        const header = JSON.parse(req.get("x-service-request-header") || "{}");
        const payload = await getStream(req)
            .then(buffer => req.is(config.textMimes) ? buffer.toString() : buffer);
        if (!service) {
            res.status(400).end("Missing args");
            return;
        }
        header.service = { name: service, capabilities };
        header.ip = getClientIp(req, config.trustProxy);
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
            pendingResponse.set(endpointId, res => res.header.error ? reject(res.header.error) : fulfill(res));
        });
        promise = pTimeout(promise, Number(req.query.timeout || 15 * 1000));
        promise = promise.finally(() => pendingResponse.delete(endpointId));
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
        if (typeof msg.header.contentType == 'string') {
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
function makeWebSocketServer(server) {
    return ws.makeServer({ server, verifyClient }).pipe(rxjs.exhaustMap(server => rxjs.merge(server.connection$.pipe(rxjs.map(con => makeEndpoint(con, config)), rxjs.mergeMap(handleConnect)), server.error$.pipe(rxjs.tap(event => console.error(event.error)))).pipe(rxjs.finalize(() => server.close()))));
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
function handleConnect(endpoint) {
    endpoints.set(endpoint.id, endpoint);
    return rxjs.merge(endpoint.message$.pipe(rxjs.concatMap(msg => processMessage(msg, endpoint))), endpoint.keepAlive$).pipe(rxjs.takeUntil(endpoint.close$.pipe(rxjs.tap(() => {
        for (const [waiterEndpointId, { responseId }] of endpoint.waiters) {
            endpoints.get(waiterEndpointId)?.send({
                header: {
                    id: responseId,
                    type: "SbEndpointWaitResponse",
                    endpointId: endpoint.id
                }
            });
        }
    }))), rxjs.finalize(() => {
        endpoints.delete(endpoint.id);
        providerRegistry.remove(endpoint);
        subscriberRegistry.remove(endpoint);
    }));
}
async function processMessage(msg, endpoint) {
    try {
        if (nonProviderRateLimiter && !endpoint.isProvider$.value) {
            try {
                await nonProviderRateLimiter.consume(endpoint.id);
            }
            catch {
                throw 'TOO_FAST';
            }
        }
        if (msg.header.to)
            handleForward(msg, endpoint);
        else if (msg.header.service)
            handleServiceRequest(msg, endpoint);
        else if (msg.header.type == "SbAdvertiseRequest")
            handleAdvertiseRequest(msg, endpoint);
        else if (msg.header.type == "SbStatusRequest")
            handleStatusRequest(msg, endpoint);
        else if (msg.header.type == "SbEndpointStatusRequest")
            handleEndpointStatusRequest(msg, endpoint);
        else if (msg.header.type == "SbEndpointWaitRequest")
            handleEndpointWaitRequest(msg, endpoint);
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
            console.error(endpoint.clientIp, endpoint.id, String(err), msg.header);
        }
    }
}
function handleForward(msg, fromEndpoint) {
    if (typeof msg.header.to != 'string')
        throw 'BAD_REQUEST';
    const endpoint = endpoints.get(msg.header.to);
    if (endpoint) {
        msg.header.from = fromEndpoint.id;
        endpoint.send(msg);
        return;
    }
    const pending = pendingResponse.get(msg.header.to);
    if (pending) {
        msg.header.from = fromEndpoint.id;
        pending(msg);
        return;
    }
    throw "ENDPOINT_NOT_FOUND";
}
function handleServiceRequest(msg, endpoint) {
    if (typeof msg.header.service != 'object' || msg.header.service == null)
        throw 'BAD_REQUEST';
    assertRecord(msg.header.service);
    if (typeof msg.header.service.name != 'string')
        throw 'BAD_REQUEST';
    if (typeof msg.header.service.capabilities != 'undefined' && !Array.isArray(msg.header.service.capabilities))
        throw 'BAD_REQUEST';
    basicStats.inc(msg.header.method ? `${msg.header.service.name}/${msg.header.method}` : msg.header.service.name);
    msg.header.from = endpoint.id;
    msg.header.ip = endpoint.clientIp;
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
function handleAdvertiseRequest(msg, endpoint) {
    const { services, topics } = immediate(() => {
        if (msg.header.services) {
            return parseAdvertisedServices(msg.header.services);
        }
        else {
            if (typeof msg.payload == 'string') {
                if (msg.payload.length > 64 * 1024)
                    throw 'PAYLOAD_TOO_LARGE';
                return parseAdvertisedServices(JSON.parse(msg.payload));
            }
            else {
                throw 'BAD_REQUEST';
            }
        }
    });
    if (services.length > 0 && config.providerAuthToken && msg.header.authToken != config.providerAuthToken)
        throw "FORBIDDEN";
    providerRegistry.remove(endpoint);
    for (const service of services)
        providerRegistry.add(endpoint, service.name, service.capabilities, service.priority ?? 0, service.httpHeaders);
    subscriberRegistry.remove(endpoint);
    for (const topic of topics)
        subscriberRegistry.add(endpoint, topic.name, topic.capabilities);
    endpoint.isProvider$.next(services.length > 0);
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
        throw 'BAD_REQUEST';
    for (const item of items) {
        if (typeof item != 'object' || item == null)
            throw 'BAD_REQUEST';
        assertRecord(item);
        const { name, capabilities, priority, httpHeaders } = item;
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
function handleStatusRequest(msg, endpoint) {
    const status = {
        numEndpoints: endpoints.size,
        providerRegistry: providerRegistry.status(),
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
function handleEndpointStatusRequest(msg, endpoint) {
    if (!Array.isArray(msg.header.endpointIds))
        throw 'BAD_REQUEST';
    endpoint.send({
        header: {
            id: msg.header.id,
            type: "SbEndpointStatusResponse",
            endpointStatuses: msg.header.endpointIds.map((id) => endpoints.has(id))
        }
    });
}
function handleEndpointWaitRequest(msg, waiterEndpoint) {
    if (typeof msg.header.endpointId != 'string')
        throw 'BAD_REQUEST';
    const target = endpoints.get(msg.header.endpointId);
    if (!target)
        throw "ENDPOINT_NOT_FOUND";
    if (target.waiters.has(waiterEndpoint.id))
        throw "ALREADY_WAITING";
    target.waiters.set(waiterEndpoint.id, { responseId: msg.header.id });
}
export const debug = {
    shutdown() {
        shutdown$.next();
    }
};
//# sourceMappingURL=index.js.map