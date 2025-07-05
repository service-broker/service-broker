import assert from "assert/strict";
import util from "util";
import { green, red, yellowBright } from "yoctocolors";
import { assertRecord, lazy, shutdown$ } from "./util.js";
const suites = [];
const scheduleRun = lazy(() => setTimeout(run, 0));
export function describe(suiteName, setup) {
    const suite = {
        name: suiteName,
        beforeEach: [],
        afterEach: [],
        tests: []
    };
    setup({
        beforeEach: run => suite.beforeEach.push(run),
        afterEach: run => suite.afterEach.push(run),
        test: (name, run) => suite.tests.push({ name, run })
    });
    suites.push(suite);
    scheduleRun();
}
export function expect(actual) {
    return {
        toEqual(expected, negate) {
            if (typeof expected == 'object' && expected !== null) {
                assert(!negate, "Negation only available for primitives");
                if (expected instanceof ExpectType) {
                    assert(typeof actual == expected.type, print(`type != '${expected.type}'`, actual));
                }
                else if (expected instanceof ExpectUnion) {
                    assert(expected.values.includes(actual), print('!expected.includes(actual)', actual, expected.values));
                }
                else if (expected instanceof ExpectObjectHaving) {
                    assert(typeof actual == 'object' && actual !== null, print('!isObject', actual));
                    assertRecord(actual);
                    for (const prop in expected.entries) {
                        assert(prop in actual, print(`Missing prop '${prop}'`, actual, expected.entries));
                        expect(actual[prop]).toEqual(expected.entries[prop]);
                    }
                }
                else if (expected instanceof Set) {
                    assert.deepStrictEqual(actual, expected);
                }
                else if (expected instanceof Map) {
                    assert(actual instanceof Map, print('!isMap', actual));
                    for (const [key] of actual) {
                        assert(expected.has(key), print(`Extra key '${key}'`, actual, expected));
                    }
                    for (const [key, expectedValue] of expected) {
                        assert(actual.has(key), print(`Missing key '${key}'`, actual, expected));
                        expect(actual.get(key)).toEqual(expectedValue);
                    }
                }
                else if (Array.isArray(expected)) {
                    assert(Array.isArray(actual), print('!isArray', actual));
                    assert.strictEqual(actual.length, expected.length);
                    for (let i = 0; i < expected.length; i++)
                        expect(actual[i]).toEqual(expected[i]);
                }
                else if (Buffer.isBuffer(expected)) {
                    assert(Buffer.isBuffer(actual), print('!isBuffer', actual));
                    assert(actual.equals(expected), print('!Buffer.equals', actual, expected));
                }
                else {
                    assert(typeof actual == 'object' && actual !== null, print('!isObject', actual));
                    assertRecord(expected);
                    assertRecord(actual);
                    for (const prop in actual) {
                        assert(prop in expected, print(`Extra prop '${prop}'`, actual, expected));
                    }
                    for (const prop in expected) {
                        assert(prop in actual, print(`Missing prop '${prop}'`, actual, expected));
                        expect(actual[prop]).toEqual(expected[prop]);
                    }
                }
            }
            else {
                if (negate)
                    assert.notStrictEqual(actual, expected);
                else
                    assert.strictEqual(actual, expected);
            }
        },
        toHaveLength(expected) {
            assert(Array.isArray(actual), print('!isArray', actual));
            assert.strictEqual(actual.length, expected);
        },
        toThrow(expected) {
            assert(typeof actual == "function");
            if (typeof expected == "string") {
                assert.throws(actual, err => {
                    assert(err instanceof Error);
                    assert.strictEqual(expected, err.message);
                    return true;
                });
            }
            else {
                assert.throws(actual, expected);
            }
        },
        async rejects(expected) {
            assert(actual instanceof Promise);
            if (typeof expected == "string") {
                await assert.rejects(actual, err => {
                    assert(err instanceof Error);
                    assert.strictEqual(expected, err.message);
                    return true;
                });
            }
            else {
                await assert.rejects(actual, expected);
            }
        }
    };
}
function print(expectation, actual, expected = print) {
    return yellowBright(expectation)
        + (expected == print ? '' : '\n' + red('EXPECT') + ' ' + util.inspect(expected))
        + '\n' + green('ACTUAL') + ' ' + util.inspect(actual);
}
export function mockFunc() {
    const func = function () {
        func.mock.calls.push(Array.from(arguments));
    };
    func.mock = {
        calls: []
    };
    return func;
}
class ExpectType {
    constructor(type) {
        this.type = type;
    }
}
export function valueOfType(type) {
    return new ExpectType(type);
}
class ExpectUnion {
    constructor(values) {
        this.values = values;
    }
}
export function oneOf(...values) {
    return new ExpectUnion(values);
}
class ExpectObjectHaving {
    constructor(entries) {
        this.entries = entries;
    }
}
export function objectHaving(entries) {
    return new ExpectObjectHaving(entries);
}
export async function run() {
    const suiteName = process.argv[2];
    const testName = process.argv[3];
    const suitesToRun = suiteName ? suites.filter(x => x.name == suiteName) : suites;
    try {
        for (const suite of suitesToRun) {
            const testsToRun = testName ? suite.tests.filter(x => x.name == testName) : suite.tests;
            for (const test of testsToRun) {
                for (const run of suite.beforeEach)
                    await run();
                try {
                    console.log("Running test '%s' '%s'", suite.name, test.name);
                    await test.run();
                }
                finally {
                    for (const run of suite.afterEach)
                        await run();
                }
            }
        }
    }
    catch (err) {
        console.error(err);
    }
    finally {
        shutdown$.next();
    }
}
//# sourceMappingURL=test-utils.js.map