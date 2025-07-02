"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProviderRegistry = void 0;
class ProviderRegistry {
    constructor() {
        this.registry = {};
        this.endpoints = new Set();
    }
    add(endpoint, name, capabilities, priority, httpHeaders) {
        const list = this.registry[name] || (this.registry[name] = []);
        //keep sorted in descending priority
        const index = list.findIndex(x => x.priority < priority);
        const provider = {
            endpoint,
            capabilities: capabilities && new Set(capabilities),
            priority,
            httpHeaders,
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
            const capableProviders = requiredCapabilities
                ? list.filter(provider => !provider.capabilities || requiredCapabilities.every(x => provider.capabilities.has(x)))
                : list;
            if (capableProviders.length)
                return capableProviders.filter(x => x.priority == capableProviders[0].priority);
        }
        return [];
    }
    cleanup() {
        for (const name in this.registry)
            if (this.registry[name].length == 0)
                delete this.registry[name];
    }
}
exports.ProviderRegistry = ProviderRegistry;
