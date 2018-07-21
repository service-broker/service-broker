"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const WebSocket = require("ws");
const dotenv = require("dotenv");
const shortid_1 = require("shortid");
class Endpoint {
    constructor(ws) {
        this.ws = ws;
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
}
class ProviderRegistry {
    constructor() {
        this.registry = {};
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
    }
    remove(endpoint) {
        for (const name in this.registry) {
            const index = this.registry[name].findIndex(x => x.endpoint == endpoint);
            if (index != -1)
                this.registry[name].splice(index, 1);
        }
    }
    find(name, requiredCapabilities) {
        const list = this.registry[name];
        if (list) {
            const capableProviders = !requiredCapabilities ? list : list.filter(provider => requiredCapabilities.every(x => !provider.capabilities || provider.capabilities.has(x)));
            if (capableProviders.length) {
                const candidates = capableProviders.filter(x => x.priority == capableProviders[0].priority);
                return pickRandom(candidates);
            }
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
const wss = new WebSocket.Server({ port: Number(process.env.PORT) });
wss.on("connection", function (ws) {
    const endpointId = shortid_1.generate();
    const endpoint = endpoints[endpointId] = new Endpoint(ws);
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
            else if (msg.header.type == "AdvertiseRequest")
                handleAdvertiseRequest(msg);
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
    ws.on("close", function () {
        if (endpoint.isProvider)
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
        const provider = providerRegistry.find(msg.header.service.name, msg.header.service.capabilities);
        if (provider) {
            msg.header.from = endpointId;
            provider.endpoint.send(msg);
        }
        else
            throw new Error("No provider");
    }
    function handleAdvertiseRequest(msg) {
        if (endpoint.isProvider) {
            providerRegistry.remove(endpoint);
            endpoint.isProvider = false;
        }
        if (msg.header.services) {
            for (const service of msg.header.services)
                providerRegistry.add(endpoint, service.name, service.capabilities, service.priority);
            endpoint.isProvider = true;
        }
        if (msg.header.id)
            endpoint.send({ header: { id: msg.header.id } });
    }
});
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
