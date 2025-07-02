import { Endpoint } from "./endpoint";

interface Provider {
  endpoint: Endpoint
  capabilities?: Set<string>
  priority: number
  httpHeaders?: string[]
}

export class ProviderRegistry {
  readonly registry: {[key: string]: Provider[]};
  readonly endpoints: Set<Endpoint>;
  constructor() {
    this.registry = {};
    this.endpoints = new Set<Endpoint>();
  }
  add(
    endpoint: Endpoint,
    name: string,
    capabilities: string[]|undefined,
    priority: number,
    httpHeaders: string[]|undefined
  ) {
    const list = this.registry[name] || (this.registry[name] = []);
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
    this.endpoints.add(endpoint);
  }
  remove(endpoint: Endpoint) {
    if (this.endpoints.has(endpoint)) {
      for (const name in this.registry) this.registry[name] = this.registry[name].filter(x => x.endpoint != endpoint);
      this.endpoints.delete(endpoint);
    }
  }
  find(name: string, requiredCapabilities: string[]|null) {
    const list = this.registry[name];
    if (list) {
      const capableProviders = requiredCapabilities
        ? list.filter(provider => !provider.capabilities || requiredCapabilities.every(x => provider.capabilities!.has(x)))
        : list;
      if (capableProviders.length)
        return capableProviders.filter(x => x.priority == capableProviders[0].priority)
    }
    return []
  }
  cleanup() {
    for (const name in this.registry) if (this.registry[name].length == 0) delete this.registry[name];
  }
}
