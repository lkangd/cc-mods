import { expect, test } from 'claude-code/testing'
import { barLabels, barOfGroup, barTarget, barsOf, hasBars } from '../hooks/bars'

/* The terminal Minimap's arithmetic (ticket 38): the cells, their blocks,
   where a press goes, when it is drawn. */

const never = () => false

test('one cell per group while they fit, a block as tall as its steps', () => {
  const bars = barsOf([0, 1, 4, 16], 40, never)
  expect(bars.map(b => [b.from, b.to])).toEqual([[0, 1], [1, 2], [2, 3], [3, 4]])
  expect(bars.map(b => b.glyph)).toEqual(['▁', '▃', '▅', '█'])
})

test('a lone group keeps the tallest block, and nothing is drawn for no groups', () => {
  expect(barsOf([3], 40, never).map(b => b.glyph)).toEqual(['█'])
  expect(barsOf([], 40, never)).toEqual([])
})

test('past the room a cell stands for consecutive groups, as tall as the most steps among them', () => {
  const steps = Array.from({ length: 100 }, (_, i) => (i === 41 ? 9 : 1))
  const bars = barsOf(steps, 40, never)
  expect(bars).toHaveLength(34)
  expect(bars[0]).toMatchObject({ from: 0, to: 3 })
  expect(bars.at(-1)).toMatchObject({ from: 99, to: 100 })
  /* Groups 39 to 41 share cell 13; group 41's 9 steps make it the tallest. */
  expect(bars[13]?.glyph).toBe('█')
  expect(bars[12]?.glyph).not.toBe('█')
  expect(bars.length).toBeLessThanOrEqual(40)
})

test('a group has one cell, and every group has one', () => {
  const bars = barsOf(Array.from({ length: 100 }, () => 1), 40, never)
  expect(barOfGroup(bars, 0)).toBe(0)
  expect(barOfGroup(bars, 41)).toBe(13)
  expect(barOfGroup(bars, 99)).toBe(bars.length - 1)
  expect(barOfGroup(bars, undefined)).toBeUndefined()
  expect(barOfGroup(bars, 100)).toBeUndefined()
})

test('a press goes to the first group of the cell that has a Jump target', () => {
  const off = new Set([0, 1])
  const bars = barsOf([1, 1, 1, 1, 1, 1], 3, g => off.has(g))
  expect(bars.map(b => [b.from, b.to])).toEqual([[0, 2], [2, 4], [4, 6]])
  /* Groups 0 and 1 have no target: the floor, and the press says why. */
  expect(bars[0]?.glyph).toBe('▁')
  expect(barTarget(bars[0]!, g => off.has(g))).toBe(0)
  expect(barTarget(bars[1]!, g => off.has(g))).toBe(2)
  const some = barsOf([1, 1, 1, 1], 2, g => g === 2)
  expect(barTarget(some[1]!, g => g === 2)).toBe(3)
  expect(some[1]?.glyph).not.toBe('▁')
})

test('it is drawn with two groups or more and rows to spare for the list', () => {
  expect(hasBars(1, 30)).toBe(false)
  expect(hasBars(2, 30)).toBe(true)
  expect(hasBars(5, 11)).toBe(true)
  expect(hasBars(5, 10)).toBe(false)
})

test('the times sit at the two ends, the first one losing its day when they do not fit', () => {
  expect(barLabels({ first: 'Oct 15 10:47', last: '11:10' }, 44)).toEqual({ left: 'Oct 15 10:47', right: '11:10', gap: 27 })
  expect(barLabels({ first: 'Oct 15 10:47', last: '11:10' }, 16)).toEqual({ left: '10:47', right: '11:10', gap: 6 })
  expect(barLabels({ first: '', last: '' }, 44)).toEqual({ left: '', right: '', gap: 44 })
})
