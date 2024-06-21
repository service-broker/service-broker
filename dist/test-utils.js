"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.describe = describe;
exports.runAll = runAll;
exports.expect = expect;
exports.mockFunc = mockFunc;
const strict_1 = __importDefault(require("assert/strict"));
const suites = [];
function describe(suite, setup) {
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
async function runAll() {
    for (const run of suites)
        await run();
}
function expect(a) {
    return {
        toBe(b) {
            strict_1.default.strictEqual(a, b);
        },
        toEqual(b) {
            strict_1.default.deepStrictEqual(a, b);
        },
        toHaveLength(b) {
            (0, strict_1.default)(Array.isArray(a));
            strict_1.default.strictEqual(a.length, b);
        },
        not: {
            toBe(b) {
                strict_1.default.notStrictEqual(a, b);
            },
            toEquals(b) {
                strict_1.default.notDeepStrictEqual(a, b);
            }
        },
        toThrow(b) {
            (0, strict_1.default)(typeof a == "function");
            if (typeof b == "string") {
                strict_1.default.throws(a, err => {
                    (0, strict_1.default)(err instanceof Error);
                    strict_1.default.strictEqual(b, err.message);
                    return true;
                });
            }
            else {
                strict_1.default.throws(a, b);
            }
        },
        async rejects(b) {
            (0, strict_1.default)(a instanceof Promise);
            if (typeof b == "string") {
                await strict_1.default.rejects(a, err => {
                    (0, strict_1.default)(err instanceof Error);
                    strict_1.default.strictEqual(b, err.message);
                    return true;
                });
            }
            else {
                await strict_1.default.rejects(a, b);
            }
        }
    };
}
function mockFunc() {
    const func = function () {
        func.mock.calls.push(Array.from(arguments));
    };
    func.mock = {
        calls: []
    };
    return func;
}
