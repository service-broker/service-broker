"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeSubscriberRegistry = makeSubscriberRegistry;
function makeSubscriberRegistry() {
    const registry = new Map();
    return {
        add(endpoint, name, capabilities) {
            let subscribers = registry.get(name);
            if (!subscribers)
                registry.set(name, subscribers = new Set());
            subscribers.add({
                endpoint,
                capabilities: capabilities && new Set(capabilities)
            });
        },
        remove(endpoint) {
            for (const [name, subscribers] of registry) {
                for (const sub of subscribers)
                    if (sub.endpoint == endpoint)
                        subscribers.delete(sub);
                if (subscribers.size == 0)
                    registry.delete(name);
            }
        },
        find(name, requiredCapabilities) {
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
        },
        status() {
            return Array.from(registry).map(([name, subscribers]) => ({
                topic: name,
                subscribers: Array.from(subscribers).map(subscriber => ({
                    endpointId: subscriber.endpoint.id,
                    capabilities: subscriber.capabilities && Array.from(subscriber.capabilities),
                }))
            }));
        },
        debug: {
            registry
        }
    };
}
