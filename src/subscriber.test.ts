import { describe, expect, objectHaving } from "@service-broker/test-utils";
import assert from "assert";
import * as subscriberRegistry from "./subscriber.js";


describe("subscriber-registry", ({ beforeEach, afterEach, test }) => {

  beforeEach(() => {
    subscriberRegistry.debug.registry.clear()
  })

  test("find", () => {
    subscriberRegistry.add('e1' as any, 't1', ['c1'])
    subscriberRegistry.add('e2' as any, 't1', ['c1', 'c2'])
    subscriberRegistry.add('e3' as any, 't1', ['c1', 'c2', 'c3'])
    subscriberRegistry.add('e4' as any, 't1', [])
    subscriberRegistry.add('e5' as any, 't1', undefined)

    //unknown topic
    assert(subscriberRegistry.find('t2', ['c1']).length == 0)

    //unknown capability
    expect(subscriberRegistry.find('t1', ['c0']), [
      objectHaving({endpoint: 'e5'})
    ])

    //single cap
    expect(subscriberRegistry.find('t1', ['c1']), [
      objectHaving({endpoint: 'e1'}),
      objectHaving({endpoint: 'e2'}),
      objectHaving({endpoint: 'e3'}),
      objectHaving({endpoint: 'e5'})
    ])

    //multiple caps
    expect(subscriberRegistry.find('t1', ['c2', 'c3']), [
      objectHaving({endpoint: 'e3'}),
      objectHaving({endpoint: 'e5'})
    ])

    //any cap
    expect(subscriberRegistry.find('t1', undefined), [
      objectHaving({endpoint: 'e1'}),
      objectHaving({endpoint: 'e2'}),
      objectHaving({endpoint: 'e3'}),
      objectHaving({endpoint: 'e4'}),
      objectHaving({endpoint: 'e5'})
    ])

    //removal
    subscriberRegistry.remove('e1' as any)
    subscriberRegistry.remove('e2' as any)

    expect(subscriberRegistry.find('t1', ['c1']), [
      objectHaving({endpoint: 'e3'}),
      objectHaving({endpoint: 'e5'})
    ])
  })
})
