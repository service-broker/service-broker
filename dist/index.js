"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const WebSocket = require("ws");
const dotenv = require("dotenv");
const shortid_1 = require("shortid");
class Endpoint {
    constructor(id, ws) {
        this.id = id;
        this.ws = ws;
        this.isAlive = true;
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
dotenv.config();
const endpoints = {};
const providerRegistry = new ProviderRegistry();
const wss = new WebSocket.Server({ port: Number(process.env.PORT) }, () => console.log(`Service broker started on ${process.env.PORT}`));
wss.on("connection", function (ws) {
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
        try {
            if (msg.header.to)
                handleForward(msg);
            else if (msg.header.service)
                handleServiceRequest(msg);
            else if (msg.header.type == "SbAdvertiseRequest")
                handleAdvertiseRequest(msg);
            else if (msg.header.type == "SbStatusRequest")
                handleStatusRequest(msg);
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
        delete endpoints[endpointId];
        providerRegistry.remove(endpoint);
    });
    function handleForward(msg) {
        const target = endpoints[msg.header.to];
        if (target) {
            msg.header.from = endpointId;
            target.send(msg);
        }
        else
            throw new Error("Destination endpoint not found");
    }
    function handleServiceRequest(msg) {
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
});
const keepAliveTimers = [
    setInterval(() => {
        for (const endpoint of providerRegistry.endpoints)
            endpoint.keepAlive();
    }, process.env.PROVIDER_KEEP_ALIVE),
    setInterval(() => {
        for (const id in endpoints)
            if (!providerRegistry.endpoints.has(endpoints[id]))
                endpoints[id].keepAlive();
    }, process.env.NON_PROVIDER_KEEP_ALIVE)
];
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
    wss.close();
    keepAliveTimers.forEach(clearInterval);
}
