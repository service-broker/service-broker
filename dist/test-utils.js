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
class FailedExpectation {
    constructor(reason, path = []) {
        this.reason = reason;
        this.path = path;
    }
}
async function run() {
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
        if (err instanceof FailedExpectation) {
            if (err.expected)
                console.error(red('EXPECT'), util.inspect(err.expected, { depth: Infinity }));
            console.error(green('ACTUAL'), util.inspect(err.actual, { depth: Infinity }));
            console.error('Error:', yellowBright('.' + err.path.join('.') + ' ' + err.reason));
            console.error(err.stack?.replace(/^Error\n/, ''));
        }
        else {
            console.error(err);
        }
    }
    finally {
        shutdown$.next();
    }
}
export class Expectation {
    constructor(operator, expected, assert) {
        Object.defineProperty(this, operator, { value: expected, enumerable: true });
        Object.defineProperty(this, 'assert', { value: assert });
    }
}
export function expect(actual, expected, path = []) {
    try {
        if (typeof expected == 'object' && expected != null) {
            if (expected instanceof Expectation) {
                try {
                    expected.assert(actual);
                }
                catch (err) {
                    if (err instanceof FailedExpectation) {
                        err.path.splice(0, 0, ...path);
                        throw err;
                    }
                    else {
                        throw new FailedExpectation(err.message || err, path);
                    }
                }
            }
            else if (expected instanceof Set) {
                try {
                    assert.deepStrictEqual(actual, expected);
                }
                catch {
                    throw new FailedExpectation('!equalExpected', path);
                }
            }
            else if (expected instanceof Map) {
                if (!(actual instanceof Map))
                    throw new FailedExpectation('!isMap', path);
                for (const [key] of actual) {
                    if (!expected.has(key))
                        throw new FailedExpectation(`hasExtraKey '${key}'`, path);
                }
                for (const [key, expectedValue] of expected) {
                    if (!actual.has(key))
                        throw new FailedExpectation(`missingKey '${key}'`, path);
                    expect(actual.get(key), expectedValue, [...path, key]);
                }
            }
            else if (Array.isArray(expected)) {
                if (!Array.isArray(actual))
                    throw new FailedExpectation('!isArray', path);
                if (actual.length != expected.length)
                    throw new FailedExpectation('!ofExpectedLength', path);
                for (let i = 0; i < actual.length; i++)
                    expect(actual[i], expected[i], [...path, String(i)]);
            }
            else if (Buffer.isBuffer(expected)) {
                if (!Buffer.isBuffer(actual))
                    throw new FailedExpectation('!isBuffer', path);
                if (!actual.equals(expected))
                    throw new FailedExpectation('!equalExpected', path);
            }
            else {
                if (!(typeof actual == 'object' && actual != null))
                    throw new FailedExpectation('!isObject', path);
                assertRecord(expected);
                assertRecord(actual);
                for (const prop in actual) {
                    if (!(prop in expected))
                        throw new FailedExpectation(`hasExtraProp '${prop}'`, path);
                }
                for (const prop in expected) {
                    if (!(prop in actual))
                        throw new FailedExpectation(`missingProp '${prop}'`, path);
                    expect(actual[prop], expected[prop], [...path, prop]);
                }
            }
        }
        else {
            if (actual !== expected)
                throw new FailedExpectation('!equalExpected', path);
        }
    }
    catch (err) {
        if (err instanceof FailedExpectation && path.length == 0) {
            err.actual = actual;
            err.expected = expected;
            Error.captureStackTrace(err, expect);
        }
        throw err;
    }
}
export function objectHaving(expectedProps) {
    return new Expectation('have', expectedProps, actual => {
        assert(typeof actual == 'object' && actual != null, '!isObject');
        assertRecord(actual);
        for (const prop in expectedProps) {
            assert(prop in actual, `missingProp '${prop}'`);
            expect(actual[prop], expectedProps[prop], [prop]);
        }
    });
}
export function valueOfType(expectedType) {
    return new Expectation('ofType', expectedType, actual => {
        assert(typeof actual == expectedType, '!ofExpectedType');
    });
}
export function oneOf(expectedValues) {
    return new Expectation('oneOf', expectedValues, actual => {
        assert(expectedValues.includes(actual), '!oneOfExpectedValues');
    });
}
export function toThrow(expectedErr) {
    return new Expectation('toThrow', expectedErr, actual => {
        assert(typeof actual == 'function', '!isFunction');
        let didNotThrow = false;
        try {
            actual();
            didNotThrow = true;
        }
        catch (err) {
            expect(err, expectedErr);
        }
        assert(!didNotThrow, 'didNotThrow');
    });
}
//# sourceMappingURL=test-utils.js.map