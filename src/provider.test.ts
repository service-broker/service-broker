import { describe, expect, objectHaving } from "@service-broker/test-utils";
import assert from "assert";
import * as providerRegistry from "./provider.js";


describe("provider-registry", ({ beforeEach, afterEach, test }) => {

  beforeEach(() => {
    providerRegistry.debug.registry.clear()
    providerRegistry.debug.endpoints.clear()
  })

  test("find", () => {
    providerRegistry.add('e1' as any, 's1', ['c1', 'c2', 'c3'], 100, undefined)
    providerRegistry.add('e2' as any, 's1', ['c1', 'c2'], 100, undefined)
    providerRegistry.add('e3' as any, 's1', ['c1'], 100, undefined)
    providerRegistry.add('e4' as any, 's1', ['c1', 'c4'], 50, undefined)
    providerRegistry.add('e5' as any, 's1', ['c4'], 200, undefined)
    providerRegistry.add('e6' as any, 's1', [], 200, undefined)
    providerRegistry.add('e7' as any, 's1', undefined, 100, undefined)
    providerRegistry.add('e8' as any, 's1', undefined, 50, undefined)

    //unknown service
    assert(providerRegistry.find('s2', ['c1']).length == 0)

    //unknown capability
    expect(providerRegistry.find('s1', ['c0']), [
      objectHaving({endpoint: 'e7'})
    ])

    //single cap
    expect(providerRegistry.find('s1', ['c1']), [
      objectHaving({endpoint: 'e1'}),
      objectHaving({endpoint: 'e2'}),
      objectHaving({endpoint: 'e3'}),
      objectHaving({endpoint: 'e7'})
    ])

    //multiple caps
    expect(providerRegistry.find('s1', ['c1', 'c2']), [
      objectHaving({endpoint: 'e1'}),
      objectHaving({endpoint: 'e2'}),
      objectHaving({endpoint: 'e7'})
    ])

    expect(providerRegistry.find('s1', ['c2', 'c3']), [
      objectHaving({endpoint: 'e1'}),
      objectHaving({endpoint: 'e7'})
    ])

    //multiple caps prioritized
    expect(providerRegistry.find('s1', ['c1', 'c4']), [
      objectHaving({endpoint: 'e7'})
    ])

    expect(providerRegistry.find('s1', ['c4']), [
      objectHaving({endpoint: 'e5'})
    ])

    //any cap
    expect(providerRegistry.find('s1', undefined), [
      objectHaving({endpoint: 'e5'}),
      objectHaving({endpoint: 'e6'})
    ])

    //removal
    providerRegistry.remove('e1' as any)
    providerRegistry.remove('e2' as any)

    expect(providerRegistry.find('s1', ['c1']), [
      objectHaving({endpoint: 'e3'}),
      objectHaving({endpoint: 'e7'})
    ])
  })
})
