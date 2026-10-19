import { expect, test } from 'claude-code/testing'
import { newMemo, remember } from '../hooks/memo'

/* The one-entry memo the drawing keeps its work in. */

test('a value is worked out again only when a key is not the same as the last call’s', () => {
  const memo = newMemo<number>()
  const table = {}
  let computed = 0
  const of = (...keys: unknown[]) => remember(memo, keys, () => ++computed)

  expect([of(table, 'a', 1), of(table, 'a', 1)]).toEqual([1, 1])
  expect(of({}, 'a', 1)).toBe(2)
  expect(of(table, 'a', 1)).toBe(3)
  expect(of(table, 'a', 1, undefined)).toBe(4)
  expect(of(table, 'a', Number.NaN)).toBe(5)
  expect(of(table, 'a', Number.NaN)).toBe(5)
})
