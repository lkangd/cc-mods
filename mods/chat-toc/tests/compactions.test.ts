import { expect, test } from 'claude-code/testing'
import { compactionsOf, hasEarlierTurnsElsewhere, rulesAmong } from '../hooks/compactions'
import { newReading, readLines } from '../hooks/regroup'
import { transcript } from './fixture'
import type { Builder } from './fixture'

/* Where each compaction falls among the Turn groups, as the chain of
   ticket 05's probe runs has it (`.scratch/chat-toc-0.2/assets/
   05-transcript-facts/runs/`): `at` is the group the rule goes before, the
   group count when it goes after the last. */

const text = (t: string) => [{ type: 'text', text: t }]

function facts(t: Builder) {
  const reading = readLines(newReading(), t.jsonl())
  return compactionsOf(reading.chain, reading.groups)
}

function turn(t: Builder, prompt: string) {
  t.prompt(prompt)
  t.reply(text(`${prompt} answer`))
  t.row({ type: 'system', subtype: 'turn_duration', durationMs: 424, isMeta: false })
}

test('a manual compaction goes after the /compact entry, though the chain has it before the command row', () => {
  const t = transcript()
  turn(t, 'CT-SYN zero')
  const boundary = t.compact('manual')
  t.row({ type: 'user', isMeta: true, message: { role: 'user', content: '<local-command-caveat>Caveat</local-command-caveat>' } })
  t.command('compact', '', 'local')
  t.row({ type: 'user', message: { role: 'user', content: '<local-command-stdout>Compacted</local-command-stdout>' } })
  turn(t, 'CT-SYN after')

  const found = facts(t)

  expect(found.map(c => [c.uuid, c.trigger, c.at])).toEqual([[boundary, 'manual', 2]])
  expect(found[0]?.timestamp).toBe(t.rows.find(r => r.uuid === boundary)?.timestamp)
})

test('an auto compaction at a submit goes before the group it fell in, which Claude worked on after it', () => {
  const t = transcript()
  turn(t, 'CT-SYN zero')
  t.prompt('CT-SYN over the threshold')
  t.row({ type: 'attachment' })
  const boundary = t.compact('auto')
  t.row({ type: 'attachment' })
  t.reply(text('CT-SYN answered after the compaction'))

  expect(facts(t).map(c => [c.uuid, c.trigger, c.at])).toEqual([[boundary, 'auto', 1]])
})

test('an auto compaction mid-turn goes after the group it fell in', () => {
  const t = transcript()
  t.prompt('CT-SYN long work')
  t.reply([{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} }])
  t.toolResult('toolu_1')
  const boundary = t.compact('auto')
  t.reply(text('CT-SYN resumed'))
  turn(t, 'CT-SYN next')

  expect(facts(t).map(c => [c.uuid, c.at])).toEqual([[boundary, 1]])
})

test("a running group's mid-turn compaction goes after it, at the list's end", () => {
  const t = transcript()
  turn(t, 'CT-SYN zero')
  t.prompt('CT-SYN running')
  t.reply([{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} }])
  t.toolResult('toolu_1')
  t.compact('auto')

  expect(facts(t).map(c => c.at)).toEqual([2])
})

test('an auto compaction between turns goes between the two groups', () => {
  const t = transcript()
  turn(t, 'CT-SYN zero')
  const boundary = t.compact('auto')
  turn(t, 'CT-SYN one')

  expect(facts(t).map(c => [c.uuid, c.at])).toEqual([[boundary, 1]])
})

test('a compaction before any group goes before the first; a rewound-away one is not on the chain', () => {
  const t = transcript()
  const first = t.compact('manual')
  turn(t, 'CT-SYN zero')
  const tip = t.rows.at(-1)?.uuid as string
  t.compact('auto')
  t.rewindTo(tip)
  turn(t, 'CT-SYN one')

  expect(facts(t).map(c => [c.uuid, c.at])).toEqual([[first, 0]])
})

/* The fork line: earlier turns are not in this session's file. */

const earlier = (t: Builder) => {
  const reading = readLines(newReading(), t.jsonl())
  return hasEarlierTurnsElsewhere(reading.chain, reading.groups)
}

test("a file that starts at a boundary whose parent row it does not hold has earlier turns elsewhere, as a fork's does", () => {
  const t = transcript()
  t.compact('manual')
  t.rows[0]!.logicalParentUuid = '99999999-0000-4000-8000-999999999999'
  t.command('compact', '', 'local')
  turn(t, 'CT-SYN forked')

  expect(earlier(t)).toBe(true)
})

test("a file whose first boundary comes before any group has earlier turns elsewhere, as a resumed one's may", () => {
  const t = transcript()
  t.row({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_0', content: 'ok' }] } })
  t.compact('manual')
  turn(t, 'CT-SYN resumed')

  expect(earlier(t)).toBe(true)
})

test('a file with its own turns before every boundary, or with none, holds the whole conversation', () => {
  const t = transcript()
  expect(earlier(t)).toBe(false)
  turn(t, 'CT-SYN zero')
  expect(earlier(t)).toBe(false)
  t.compact('auto')
  turn(t, 'CT-SYN one')
  expect(earlier(t)).toBe(false)
})

/* The rules among the groups shown: whatever the View filter (or a query)
   leaves, each compaction's rule goes before the first shown group at or
   after its place, or after the last; several in one place fold. */

const c = (at: number, minute: number, trigger: 'manual' | 'auto' = 'manual') => ({
  uuid: `b${at}-${minute}`,
  trigger,
  timestamp: new Date(Date.UTC(2026, 9, 10, 6, minute)).toISOString(),
  at,
  isAnswered: true,
})

test('each rule goes before the first group shown at or after its place', () => {
  const placed = rulesAmong([c(1, 1), c(3, 3, 'auto')], [0, 1, 2, 3])

  expect([...placed.before]).toEqual([
    [1, { trigger: 'manual', count: 1, timestamp: c(1, 1).timestamp }],
    [3, { trigger: 'auto', count: 1, timestamp: c(3, 3).timestamp }],
  ])
  expect(placed.after).toBeUndefined()
})

test('rules between groups a filter hides move down to the next group shown, and fold with the last one’s time and trigger', () => {
  const placed = rulesAmong([c(1, 1), c(2, 2), c(3, 3, 'auto')], [0, 3])

  expect([...placed.before]).toEqual([[3, { trigger: 'auto', count: 3, timestamp: c(3, 3).timestamp }]])
})

test('rules past the last group shown go after it; with no group shown there are none', () => {
  expect(rulesAmong([c(2, 2), c(4, 4)], [0, 1]).after).toEqual({ trigger: 'manual', count: 2, timestamp: c(4, 4).timestamp })
  expect(rulesAmong([c(4, 4)], [0, 1, 2, 3, 4]).after).toBeUndefined()
  const none = rulesAmong([c(0, 0)], [])
  expect([none.before.size, none.after]).toEqual([0, undefined])
})

test('a compaction is answered once a response follows it on the chain', () => {
  const t = transcript()
  turn(t, 'CT-SYN zero')
  t.compact('manual')
  t.command('compact', '', 'local')
  expect(facts(t).map(x => x.isAnswered)).toEqual([false])
  turn(t, 'CT-SYN after')
  t.compact('auto')
  expect(facts(t).map(x => x.isAnswered)).toEqual([true, false])
})
