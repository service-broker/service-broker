import { AssertionError } from "assert";
import assert from "assert/strict";
import util from "util";
import { green, red, yellowBright } from "yoctocolors";
import { assertRecord, lazy, shutdown$ } from "./util.js";

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
    if (err instanceof AssertionError) {
      console.error(red('EXPECT'), util.inspect(err.expected))
      console.error(green('ACTUAL'), util.inspect(err.actual))
    }
    console.error(err)
  } finally {
    shutdown$.next()
  }
}



export function expect(actual: unknown) {
  return {
    toEqual(expected: unknown) {
      try {
        assertEquals(actual, expected, [])
      } catch (err) {
        if (Array.isArray(err)) {
          const [failure, path] = err
          throw new AssertionError({ message: path.join('.') + ' ' + failure, actual, expected })
        } else {
          throw err
        }
      }
    },
    toContain(expected: Record<string, unknown>) {
      if (!(typeof actual == 'object' && actual != null)) {
          throw new AssertionError({ message: '!isObject', actual, expected })
      }
      assertRecord(actual)
      for (const prop in expected) {
        if (!(prop in actual)) {
          throw new AssertionError({ message: prop + ' missing', actual, expected })
        }
        try {
          assertEquals(actual[prop], expected[prop], [prop])
        } catch (err) {
          if (Array.isArray(err)) {
            const [failure, path] = err
            throw new AssertionError({ message: failure + ' ' + path.join('.'), actual, expected })
          } else {
            throw err
          }
        }
      }
    }
  }
}

function assertEquals(actual: unknown, expected: unknown, path: unknown[]) {
  if (typeof expected == 'object' && expected != null) {
    if (expected instanceof Set) {
      assert.deepStrictEqual(actual, expected)
    }
    else if (expected instanceof Map) {
      if (!(actual instanceof Map)) throw ['!isMap', path]
      for (const [key] of actual) {
        if (!expected.has(key)) throw ['Extra key', [...path, key]]
      }
      for (const [key, expectedValue] of expected) {
        if (!actual.has(key)) throw ['Missing key', [...path, key]]
        assertEquals(actual.get(key), expectedValue, [...path, key])
      }
    }
    else if (Array.isArray(expected)) {
      if (!Array.isArray(actual)) throw ['!isArray', path]
      if (actual.length != expected.length) throw ['!=', path]
      for (let i=0; i<actual.length; i++)
        assertEquals(actual[i], expected[i], [...path, i])
    }
    else if (Buffer.isBuffer(expected)) {
      if (!Buffer.isBuffer(actual)) throw ['!isBuffer', path]
      if (!actual.equals(expected)) throw ['!=', path]
    }
    else {
      if (!(typeof actual == 'object' && actual != null)) throw ['!isObject', path]
      assertRecord(expected)
      assertRecord(actual)
      for (const prop in actual) {
        if (!(prop in expected)) throw ['Extra prop', [...path, prop]]
      }
      for (const prop in expected) {
        if (!(prop in actual)) throw ['Missing prop', [...path, prop]]
        assertEquals(actual[prop], expected[prop], [...path, prop])
      }
    }
  } else if (typeof expected == 'function') {
    assert(typeof expected(actual) == 'undefined', 'Assertion function must not return a value')
  } else {
    if (actual !== expected) throw ['!==', path]
  }
}
