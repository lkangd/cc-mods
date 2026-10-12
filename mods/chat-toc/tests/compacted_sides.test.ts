import { expect, test } from 'claude-code/testing'
import { compactedSides, lastBoundary, refusalFrame } from '../hooks/jump'
import { newReading, readLines } from '../hooks/regroup'
import { newSites, rowIndex } from '../hooks/sites'
import { transcript } from './fixture'
import type { Builder } from './fixture'

/* CT-JUMP-005 at the seam: in a session this process resumed, the host
   lists none of the rows before the last compaction the file had then, so
   every side whose jump targets all lie before it is known refused before
   anyone presses it. CT-UI-005: how the refusal flashes when it is said. */

const text = (t: string) => [{ type: 'text', text: t }]

function read(t: Builder) {
  const reading = readLines(newReading(), t.jsonl())
  return { reading, rows: rowIndex(reading.chain) }
}

function turn(t: Builder, prompt: string) {
  t.prompt(prompt)
  t.reply(text(`${prompt} answer`))
}

test('the boundary is the last compaction on the chain, none without one', () => {
  const t = transcript()
  turn(t, 'CT-SYN one')
  expect(lastBoundary(read(t).reading.chain)).toBeUndefined()
  const first = t.compact()
  turn(t, 'CT-SYN two')
  expect(lastBoundary(read(t).reading.chain)).toBe(first)
  const second = t.compact()
  turn(t, 'CT-SYN three')
  expect(lastBoundary(read(t).reading.chain)).toBe(second)
})

test('every side of every turn before the boundary is known refused, none after it', () => {
  const t = transcript()
  turn(t, 'CT-SYN zero')
  turn(t, 'CT-SYN one')
  const boundary = t.compact()
  turn(t, 'CT-SYN two')
  const { reading, rows } = read(t)
  const opener = (i: number) => reading.groups[i]!.openerUuid

  const known = compactedSides(reading.groups, rows, newSites(), boundary)

  expect([...known.keys()].sort()).toEqual([`${opener(0)}.agent`, `${opener(0)}.user`, `${opener(1)}.agent`, `${opener(1)}.user`].sort())
  expect(known.get(`${opener(1)}.user`)).toEqual({ side: 'user', opener: opener(1), groupIndex: 1, why: 'compacted' })
})

test('without a boundary nothing is known refused', () => {
  const t = transcript()
  turn(t, 'CT-SYN zero')
  t.compact()
  turn(t, 'CT-SYN one')
  const { reading, rows } = read(t)
  expect(compactedSides(reading.groups, rows, newSites(), undefined).size).toBe(0)
})

test('turns after the boundary stay unknown, compacted again since or not', () => {
  const t = transcript()
  turn(t, 'CT-SYN zero')
  const atResume = t.compact()
  turn(t, 'CT-SYN one')
  t.compact()
  turn(t, 'CT-SYN two')
  const { reading, rows } = read(t)

  const known = compactedSides(reading.groups, rows, newSites(), atResume)

  expect(new Set([...known.values()].map(k => k.groupIndex))).toEqual(new Set([0]))
})

test('a command just before the boundary jumps to the rows after it, so it is not known refused', () => {
  const t = transcript()
  turn(t, 'CT-SYN zero')
  t.localCommand('tui', '')
  const boundary = t.compact()
  turn(t, 'CT-SYN one')
  const { reading, rows } = read(t)
  const command = reading.groups[1]!

  const known = compactedSides(reading.groups, rows, newSites(), boundary)

  expect(known.has(`${command.openerUuid}.user`)).toBe(false)
  expect(known.has(`${reading.groups[0]!.openerUuid}.user`)).toBe(true)
})

test('the refusal flashes inverse three times, 150 ms lit and 150 ms not, then stays lit', () => {
  const lit = [0, 149, 300, 449, 600, 749].map(refusalFrame)
  const unlit = [150, 299, 450, 599, 750, 899, 900, 4999].map(refusalFrame)
  expect(lit.every(f => f.isInverse)).toBe(true)
  expect(unlit.every(f => !f.isInverse)).toBe(true)
})
