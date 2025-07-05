import * as providerRegistry from "./provider.js";
import { describe, expect, objectHaving } from "./test-utils.js";
describe("provider-registry", ({ beforeEach, afterEach, test }) => {
    beforeEach(() => {
        providerRegistry.debug.registry.clear();
        providerRegistry.debug.endpoints.clear();
    });
    test("find", () => {
        providerRegistry.add('e1', 's1', ['c1', 'c2', 'c3'], 100, undefined);
        providerRegistry.add('e2', 's1', ['c1', 'c2'], 100, undefined);
        providerRegistry.add('e3', 's1', ['c1'], 100, undefined);
        providerRegistry.add('e4', 's1', ['c1', 'c4'], 50, undefined);
        providerRegistry.add('e5', 's1', ['c4'], 200, undefined);
        providerRegistry.add('e6', 's1', [], 200, undefined);
        providerRegistry.add('e7', 's1', undefined, 100, undefined);
        providerRegistry.add('e8', 's1', undefined, 50, undefined);
        //unknown service
        expect(providerRegistry.find('s2', ['c1'])).toHaveLength(0);
        //unknown capability
        expect(providerRegistry.find('s1', ['c0'])).toEqual([
            objectHaving({ endpoint: 'e7' })
        ]);
        //single cap
        expect(providerRegistry.find('s1', ['c1'])).toEqual([
            objectHaving({ endpoint: 'e1' }),
            objectHaving({ endpoint: 'e2' }),
            objectHaving({ endpoint: 'e3' }),
            objectHaving({ endpoint: 'e7' })
        ]);
        //multiple caps
        expect(providerRegistry.find('s1', ['c1', 'c2'])).toEqual([
            objectHaving({ endpoint: 'e1' }),
            objectHaving({ endpoint: 'e2' }),
            objectHaving({ endpoint: 'e7' })
        ]);
        expect(providerRegistry.find('s1', ['c2', 'c3'])).toEqual([
            objectHaving({ endpoint: 'e1' }),
            objectHaving({ endpoint: 'e7' })
        ]);
        //multiple caps prioritized
        expect(providerRegistry.find('s1', ['c1', 'c4'])).toEqual([
            objectHaving({ endpoint: 'e7' })
        ]);
        expect(providerRegistry.find('s1', ['c4'])).toEqual([
            objectHaving({ endpoint: 'e5' })
        ]);
        //any cap
        expect(providerRegistry.find('s1', undefined)).toEqual([
            objectHaving({ endpoint: 'e5' }),
            objectHaving({ endpoint: 'e6' })
        ]);
        //removal
        providerRegistry.remove('e1');
        providerRegistry.remove('e2');
        expect(providerRegistry.find('s1', ['c1'])).toEqual([
            objectHaving({ endpoint: 'e3' }),
            objectHaving({ endpoint: 'e7' })
        ]);
    });
});
//# sourceMappingURL=provider.test.js.map