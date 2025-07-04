const registry = new Map();
const endpoints = new Set();
export function add(endpoint, name, capabilities, priority, httpHeaders) {
    let list = registry.get(name);
    if (!list)
        registry.set(name, list = []);
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
    endpoints.add(endpoint);
}
export function remove(endpoint) {
    if (endpoints.has(endpoint)) {
        endpoints.delete(endpoint);
        for (const [name, providers] of registry) {
            const filtered = providers.filter(x => x.endpoint != endpoint);
            if (filtered.length != providers.length) {
                if (filtered.length)
                    registry.set(name, filtered);
                else
                    registry.delete(name);
            }
        }
    }
}
export function find(name, requiredCapabilities) {
    const list = registry.get(name);
    if (list) {
        const capableProviders = requiredCapabilities
            ? list.filter(provider => !provider.capabilities || requiredCapabilities.every(x => provider.capabilities.has(x)))
            : list;
        if (capableProviders.length)
            return capableProviders.filter(x => x.priority == capableProviders[0].priority);
    }
    return [];
}
export function status() {
    return Array.from(registry).map(([name, providers]) => ({
        service: name,
        providers: providers.map(({ endpoint, capabilities, priority }) => ({
            endpointId: endpoint.id,
            capabilities: capabilities && Array.from(capabilities),
            priority
        }))
    }));
}
export const debug = {
    registry,
    endpoints
};
