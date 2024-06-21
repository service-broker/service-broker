import assert from "assert/strict";

const suites: Array<Function> = []

export function describe(
  suite: string,
  setup: (opts: {beforeEach: Function, afterEach: Function, test: Function}) => void
) {
  const before: Array<Function> = []
  const after: Array<Function> = []
  const tests: Array<{name: string, run: Function}> = []
  setup({
    beforeEach: (f: Function) => before.push(f),
    afterEach: (f: Function) => after.push(f),
    test: (name: string, run: Function) => tests.push({name, run})
  })
  suites.push(async function() {
    for (const {name, run} of tests) {
      for (const f of before) await f()
      try {
        console.log("Running test '%s' '%s'", suite, name)
        await run()
      }
      finally {
        for (const f of after) await f()
      }
    }
  })
}

export async function runAll() {
  for (const run of suites) await run()
}

export function expect(a: unknown) {
  return {
    toBe(b: unknown) {
      assert.strictEqual(a, b)
    },
    toEqual(b: unknown) {
      assert.deepStrictEqual(a, b)
    },
    toHaveLength(b: number) {
      assert(Array.isArray(a))
      assert.strictEqual(a.length, b)
    },
    not: {
      toBe(b: unknown) {
        assert.notStrictEqual(a, b)
      },
      toEquals(b: unknown) {
        assert.notDeepStrictEqual(a, b)
      }
    },
    toThrow(b: string|assert.AssertPredicate) {
      assert(typeof a == "function")
      if (typeof b == "string") {
        assert.throws(a as () => void, err => {
          assert(err instanceof Error)
          assert.strictEqual(b, err.message)
          return true
        })
      }
      else {
        assert.throws(a as () => void, b)
      }
    },
    async rejects(b: string|assert.AssertPredicate) {
      assert(a instanceof Promise)
      if (typeof b == "string") {
        await assert.rejects(a, err => {
          assert(err instanceof Error)
          assert.strictEqual(b, err.message)
          return true
        })
      }
      else {
        await assert.rejects(a, b)
      }
    }
  }
}

export type MockFunc = (() => void) & {
  mock: {
    calls: Array<unknown>
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
