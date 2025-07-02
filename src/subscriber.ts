import { Endpoint } from "./endpoint.js";

interface Subscriber {
  endpoint: Endpoint
  capabilities?: Set<string>
}

const registry = new Map<string, Set<Subscriber>>()

export function add(endpoint: Endpoint, name: string, capabilities: string[]|undefined) {
  let subscribers = registry.get(name)
  if (!subscribers) registry.set(name, subscribers = new Set())
  subscribers.add({
    endpoint,
    capabilities: capabilities && new Set(capabilities)
  })
}

export function remove(endpoint: Endpoint) {
  for (const [name, subscribers] of registry) {
    for (const sub of subscribers) if (sub.endpoint == endpoint) subscribers.delete(sub)
    if (subscribers.size == 0) registry.delete(name)
  }
}

export function find(name: string, requiredCapabilities: string[]|null) {
  const subscribers = registry.get(name)
  if (subscribers) {
    const list = Array.from(subscribers)
    return requiredCapabilities
      ? list.filter(sub => !sub.capabilities || requiredCapabilities.every(x => sub.capabilities!.has(x)))
      : list
  } else {
    return []
  }
}

export function status() {
  return Array.from(registry).map(([name, subscribers]) => ({
    topic: name,
    subscribers: Array.from(subscribers).map(subscriber => ({
      endpointId: subscriber.endpoint.id,
      capabilities: subscriber.capabilities && Array.from(subscriber.capabilities),
    }))
  }))
}

export const debug = {
  registry
}
