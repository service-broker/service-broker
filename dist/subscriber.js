const registry = new Map();
export function add(endpoint, name, capabilities) {
    let subscribers = registry.get(name);
    if (!subscribers)
        registry.set(name, subscribers = new Set());
    subscribers.add({
        endpoint,
        capabilities: capabilities && new Set(capabilities)
    });
}
export function remove(endpoint) {
    for (const [name, subscribers] of registry) {
        for (const sub of subscribers)
            if (sub.endpoint == endpoint)
                subscribers.delete(sub);
        if (subscribers.size == 0)
            registry.delete(name);
    }
}
export function find(name, requiredCapabilities) {
    const subscribers = registry.get(name);
    if (subscribers) {
        const list = Array.from(subscribers);
        return requiredCapabilities
            ? list.filter(sub => !sub.capabilities || requiredCapabilities.every(x => sub.capabilities.has(x)))
            : list;
    }
    else {
        return [];
    }
}
export function status() {
    return Array.from(registry).map(([name, subscribers]) => ({
        topic: name,
        subscribers: Array.from(subscribers).map(subscriber => ({
            endpointId: subscriber.endpoint.id,
            capabilities: subscriber.capabilities && Array.from(subscriber.capabilities),
        }))
    }));
}
export const debug = {
    registry
};
//# sourceMappingURL=subscriber.js.map