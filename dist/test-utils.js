import assert from "assert/strict";
const suites = [];
export function describe(suite, setup) {
    const before = [];
    const after = [];
    const tests = [];
    setup({
        beforeEach: (f) => before.push(f),
        afterEach: (f) => after.push(f),
        test: (name, run) => tests.push({ name, run })
    });
    suites.push(async function () {
        for (const { name, run } of tests) {
            for (const f of before)
                await f();
            try {
                console.log("Running test '%s' '%s'", suite, name);
                await run();
            }
            finally {
                for (const f of after)
                    await f();
            }
        }
    });
}
export async function runAll() {
    for (const run of suites)
        await run();
}
export function expect(a) {
    return {
        toBe(b) {
            assert.strictEqual(a, b);
        },
        toEqual(b) {
            assert.deepStrictEqual(a, b);
        },
        toHaveLength(b) {
            assert(Array.isArray(a));
            assert.strictEqual(a.length, b);
        },
        not: {
            toBe(b) {
                assert.notStrictEqual(a, b);
            },
            toEquals(b) {
                assert.notDeepStrictEqual(a, b);
            }
        },
        toThrow(b) {
            assert(typeof a == "function");
            if (typeof b == "string") {
                assert.throws(a, err => {
                    assert(err instanceof Error);
                    assert.strictEqual(b, err.message);
                    return true;
                });
            }
            else {
                assert.throws(a, b);
            }
        },
        async rejects(b) {
            assert(a instanceof Promise);
            if (typeof b == "string") {
                await assert.rejects(a, err => {
                    assert(err instanceof Error);
                    assert.strictEqual(b, err.message);
                    return true;
                });
            }
            else {
                await assert.rejects(a, b);
            }
        }
    };
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
