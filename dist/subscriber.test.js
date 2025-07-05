import * as subscriberRegistry from "./subscriber.js";
import { describe, expect, objectHaving } from "./test-utils.js";
describe("subscriber-registry", ({ beforeEach, afterEach, test }) => {
    beforeEach(() => {
        subscriberRegistry.debug.registry.clear();
    });
    test("find", () => {
        subscriberRegistry.add('e1', 't1', ['c1']);
        subscriberRegistry.add('e2', 't1', ['c1', 'c2']);
        subscriberRegistry.add('e3', 't1', ['c1', 'c2', 'c3']);
        subscriberRegistry.add('e4', 't1', []);
        subscriberRegistry.add('e5', 't1', undefined);
        //unknown topic
        expect(subscriberRegistry.find('s2', ['c1'])).toHaveLength(0);
        //unknown capability
        expect(subscriberRegistry.find('t1', ['c0'])).toEqual([
            objectHaving({ endpoint: 'e5' })
        ]);
        //single cap
        expect(subscriberRegistry.find('t1', ['c1'])).toEqual([
            objectHaving({ endpoint: 'e1' }),
            objectHaving({ endpoint: 'e2' }),
            objectHaving({ endpoint: 'e3' }),
            objectHaving({ endpoint: 'e5' })
        ]);
        //multiple caps
        expect(subscriberRegistry.find('t1', ['c1', 'c2'])).toEqual([
            objectHaving({ endpoint: 'e2' }),
            objectHaving({ endpoint: 'e3' }),
            objectHaving({ endpoint: 'e5' })
        ]);
        expect(subscriberRegistry.find('t1', ['c2', 'c3'])).toEqual([
            objectHaving({ endpoint: 'e3' }),
            objectHaving({ endpoint: 'e5' })
        ]);
        //any cap
        expect(subscriberRegistry.find('t1', undefined)).toEqual([
            objectHaving({ endpoint: 'e1' }),
            objectHaving({ endpoint: 'e2' }),
            objectHaving({ endpoint: 'e3' }),
            objectHaving({ endpoint: 'e4' }),
            objectHaving({ endpoint: 'e5' })
        ]);
        //removal
        subscriberRegistry.remove('e1');
        subscriberRegistry.remove('e2');
        expect(subscriberRegistry.find('t1', ['c1'])).toEqual([
            objectHaving({ endpoint: 'e3' }),
            objectHaving({ endpoint: 'e5' })
        ]);
    });
});
//# sourceMappingURL=subscriber.test.js.map