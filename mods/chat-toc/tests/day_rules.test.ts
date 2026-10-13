import { expect, test } from 'claude-code/testing'
import { dayLabel, dayRuleBefore, entriesOf } from '../hooks/entries'
import type { Layout, ViewFilter } from '../hooks/view'
import { entryHeight } from '../hooks/pane'
import { tocModel } from '../hooks/model'
import { transcript } from './fixture'
import type { Builder } from './fixture'

/* The day's rule: the list says the day where it changes, the first group's
   included, today as 今天. */

const NOW = new Date(2026, 9, 10, 18, 0).getTime()

const build = (t: Builder, layout: Layout = 'card', filter: ViewFilter = 'all') =>
  entriesOf(tocModel(t.jsonl()).groups, { layout, filter, width: 44, nowMs: NOW, isRunning: false })

/* Puts the row `uuid` at local `when`. */
function at(t: Builder, uuid: string, when: Date) {
  const row = t.rows.find(r => r.uuid === uuid)
  if (row) row.timestamp = when.toISOString()
}

/* Two groups the day before, two today. */
function twoDays(): Builder {
  const t = transcript()
  at(t, t.prompt('CT-SYN late one'), new Date(2026, 9, 9, 22, 41))
  t.reply([{ type: 'text', text: 'CT-SYN late answer' }])
  at(t, t.prompt('CT-SYN late two'), new Date(2026, 9, 9, 22, 58))
  at(t, t.prompt('CT-SYN morning one'), new Date(2026, 9, 10, 9, 2))
  t.reply([{ type: 'text', text: 'CT-SYN morning answer' }])
  at(t, t.prompt('CT-SYN morning two'), new Date(2026, 9, 10, 9, 5))
  return t
}

const rules = (t: Builder, layout: Layout = 'card', filter: ViewFilter = 'all') => {
  const entries = build(t, layout, filter)
  return entries.map((e, i) => [e.key, dayRuleBefore(entries, i)])
}

test('a day reads month and day, today says so, another year says the year', () => {
  expect(dayLabel(new Date(2026, 9, 9, 22, 41).toISOString(), NOW)).toBe('10月9日')
  expect(dayLabel(new Date(2026, 9, 10, 0, 0).toISOString(), NOW)).toBe('今天 · 10月10日')
  expect(dayLabel(new Date(2025, 0, 2, 23, 59).toISOString(), NOW)).toBe('2025年1月2日')
  expect(dayLabel(undefined, NOW)).toBe('')
  expect(dayLabel('not a time', NOW)).toBe('')
})

test("a rule goes before the first group and before each group whose day is not the one before it", () => {
  expect(rules(twoDays())).toEqual([
    ['g0.u', '10月9日'],
    ['g0.a', undefined],
    ['g1.u', undefined],
    ['g2.u', '今天 · 10月10日'],
    ['g2.a', undefined],
    ['g3.u', undefined],
  ])
})

test('the rules follow the sides the filter shows', () => {
  expect(rules(twoDays(), 'compact', 'agent')).toEqual([
    ['g0.a', '10月9日'],
    ['g2.a', '今天 · 10月10日'],
  ])
})

test('a group without a time neither draws a rule nor ends the day before it', () => {
  const t = twoDays()
  const untimed = t.prompt('CT-SYN untimed')
  delete t.rows.find(r => r.uuid === untimed)?.timestamp
  at(t, t.prompt('CT-SYN still today'), new Date(2026, 9, 10, 9, 30))

  expect(rules(t).slice(-2)).toEqual([
    ['g4.u', undefined],
    ['g5.u', undefined],
  ])
})

test("an entry's rows count its day's rule", () => {
  const entries = build(twoDays())
  /* g0.u: the rule and one line; g0.a: one line and the gap; g2.u: the rule and one line. */
  expect(entries.map((_, i) => entryHeight(entries, i))).toEqual([2, 2, 2, 2, 2, 1])
})
