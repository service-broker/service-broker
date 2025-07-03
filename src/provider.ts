import { Endpoint } from "./endpoint.js";

interface Provider {
  endpoint: Endpoint
  capabilities?: Set<string>
  priority: number
  httpHeaders?: string[]
}

const registry = new Map<string, Provider[]>()
const endpoints = new Set<Endpoint>()

export function has(endpoint: Endpoint) {
  return endpoints.has(endpoint)
}

export function add(
  endpoint: Endpoint,
  name: string,
  capabilities: string[]|undefined,
  priority: number,
  httpHeaders: string[]|undefined
) {
  let list = registry.get(name)
  if (!list) registry.set(name, list = [])
  //keep sorted in descending priority
  const index = list.findIndex(x => x.priority < priority);
  const provider: Provider = {
    endpoint,
    capabilities: capabilities && new Set(capabilities),
    priority,
    httpHeaders,
  };
  if (index != -1) list.splice(index, 0, provider);
  else list.push(provider);
  endpoints.add(endpoint)
}

export function remove(endpoint: Endpoint) {
  if (endpoints.has(endpoint)) {
    endpoints.delete(endpoint)
    for (const [name, providers] of registry) {
      const filtered = providers.filter(x => x.endpoint != endpoint)
      if (filtered.length != providers.length)
        registry.set(name, filtered)
    }
  }
}

export function find(name: string, requiredCapabilities: string[]|undefined) {
  const list = registry.get(name)
  if (list) {
    const capableProviders = requiredCapabilities
      ? list.filter(provider => !provider.capabilities || requiredCapabilities.every(x => provider.capabilities!.has(x)))
      : list;
    if (capableProviders.length)
      return capableProviders.filter(x => x.priority == capableProviders[0].priority)
  }
  return []
}

export function status() {
  return Array.from(registry).map(([name, providers]) => ({
    service: name,
    providers: providers.map(({endpoint, capabilities, priority}) => ({
      endpointId: endpoint.id,
      capabilities: capabilities && Array.from(capabilities),
      priority
    }))
  }))
}

export function cleanup() {
  for (const [name, providers] of registry)
    if (providers.length == 0)
      registry.delete(name)
}

export const debug = {
  registry,
  endpoints
}
