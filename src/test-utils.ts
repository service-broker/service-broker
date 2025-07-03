import assert from "assert/strict";
import util from "util";
import { green, red, yellowBright } from "yoctocolors";
import { debug as indexDebug } from "./index.js";
import { assertRecord, lazy } from "./util.js";

interface Test {
  name: string
  run: Function
}

interface Suite {
  name: string
  beforeEach: Function[]
  afterEach: Function[]
  tests: Test[]
}

const suites: Suite[] = []
const scheduleRun = lazy(() => setTimeout(run, 0))


export function describe(
  suiteName: string,
  setup: (opts: {
    beforeEach: (run: Function) => void
    afterEach: (run: Function) => void
    test: (name: string, run: Function) => void
  }) => void
) {
  const suite: Suite = {
    name: suiteName,
    beforeEach: [],
    afterEach: [],
    tests: []
  }
  setup({
    beforeEach: run => suite.beforeEach.push(run),
    afterEach: run => suite.afterEach.push(run),
    test: (name, run) => suite.tests.push({name, run})
  })
  suites.push(suite)
  scheduleRun()
}

export function expect(actual: unknown) {
  return {
    toEqual(expected: unknown, negate?: 'negate') {
      if (typeof expected == 'object' && expected !== null) {
        assert(!negate, "Negation only available for primitives")
        if (expected instanceof ExpectType) {
          assert(typeof actual == expected.type, print(`type != '${expected.type}'`, actual))
        }
        else if (expected instanceof ExpectUnion) {
          assert(expected.values.includes(actual), print('!expected.includes(actual)', actual, expected.values))
        }
        else if (expected instanceof Set) {
          assert.deepStrictEqual(actual, expected)
        }
        else if (expected instanceof Map) {
          assert(actual instanceof Map, print('!isMap', actual))
          for (const [key] of actual) {
            assert(expected.has(key), print(`Extra key '${key}'`, actual, expected))
          }
          for (const [key, expectedValue] of expected) {
            assert(actual.has(key), print(`Missing key '${key}'`, actual, expected))
            expect(actual.get(key)).toEqual(expectedValue)
          }
        }
        else if (Array.isArray(expected)) {
          assert(Array.isArray(actual), print('!isArray', actual))
          assert.strictEqual(actual.length, expected.length)
          for (let i=0; i<expected.length; i++) expect(actual[i]).toEqual(expected[i])
        }
        else if (Buffer.isBuffer(expected)) {
          assert(Buffer.isBuffer(actual), print('!isBuffer', actual))
          assert(actual.equals(expected), print('!Buffer.equals', actual, expected))
        }
        else {
          assert(typeof actual == 'object' && actual !== null, print('!isObject', actual))
          assertRecord(expected)
          assertRecord(actual)
          for (const prop in actual) {
            assert(prop in expected, print(`Extra prop '${prop}'`, actual, expected))
          }
          for (const prop in expected) {
            assert(prop in actual, print(`Missing prop '${prop}'`, actual, expected))
            expect(actual[prop]).toEqual(expected[prop])
          }
        }
      }
      else {
        if (negate) assert.notStrictEqual(actual, expected)
        else assert.strictEqual(actual, expected)
      }
    },
    toHaveLength(expected: number) {
      assert(Array.isArray(actual), print('!isArray', actual))
      assert.strictEqual(actual.length, expected)
    },
    toThrow(expected: string|assert.AssertPredicate) {
      assert(typeof actual == "function")
      if (typeof expected == "string") {
        assert.throws(actual as () => void, err => {
          assert(err instanceof Error)
          assert.strictEqual(expected, err.message)
          return true
        })
      }
      else {
        assert.throws(actual as () => void, expected)
      }
    },
    async rejects(expected: string|assert.AssertPredicate) {
      assert(actual instanceof Promise)
      if (typeof expected == "string") {
        await assert.rejects(actual, err => {
          assert(err instanceof Error)
          assert.strictEqual(expected, err.message)
          return true
        })
      }
      else {
        await assert.rejects(actual, expected)
      }
    }
  }
}

function print(expectation: string, actual: unknown, expected: unknown = print) {
  return yellowBright(expectation)
    + (expected == print ? '' : '\n' + red('EXPECT') + ' ' + util.inspect(expected))
    + '\n' + green('ACTUAL') + ' ' + util.inspect(actual)
}

export type MockFunc = (() => void) & {
  mock: {
    calls: unknown[]
  }
}

export function mockFunc(): MockFunc {
  const func: MockFunc = function() {
    func.mock.calls.push(Array.from(arguments))
  }
  func.mock = {
    calls: []
  }
  return func
}

class ExpectType {
  constructor(readonly type: 'string'|'number') {
  }
}

export function valueOfType(type: 'string'|'number') {
  return new ExpectType(type)
}

class ExpectUnion {
  constructor(readonly values: unknown[]) {
  }
}

export function oneOf(...values: (string|number|undefined|null)[]) {
  return new ExpectUnion(values)
}

export async function run() {
  const suiteName = process.argv[2]
  const testName = process.argv[3]
  const suitesToRun = suiteName ? suites.filter(x => x.name == suiteName) : suites
  try {
    for (const suite of suitesToRun) {
      const testsToRun = testName ? suite.tests.filter(x => x.name == testName) : suite.tests
      for (const test of testsToRun) {
        for (const run of suite.beforeEach) await run()
        try {
          console.log("Running test '%s' '%s'", suite.name, test.name)
          await test.run()
        } finally {
          for (const run of suite.afterEach) await run()
        }
      }
    }
  } catch (err) {
    console.error(err)
  } finally {
    indexDebug.shutdown$.next()
  }
}
