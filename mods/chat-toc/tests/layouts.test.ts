import { expect, test } from 'claude-code/testing'
import { entriesOf } from '../hooks/entries'
import type { Entry } from '../hooks/entries'
import { textCells } from '../hooks/cells'
import { tocModel } from '../hooks/model'
import type { Layout, ViewFilter } from '../hooks/view'
import { filterOf, layoutOf, nextLayout } from '../hooks/view'
import { transcript } from './fixture'
import type { Builder, Row } from './fixture'

/* The View filter and the three Layouts, at the seam that builds the
   entries: which sides show, and the lines each side draws. */

const NOW = new Date(2026, 9, 10, 18, 0).getTime()
const tool = (id: string): Row => ({ type: 'tool_use', id, name: 'Bash', input: {} })
const text = (t: string): Row => ({ type: 'text', text: t })

const build = (t: Builder, layout: Layout, filter: ViewFilter = 'all', width = 44, isRunning = false) =>
  entriesOf(tocModel(t.jsonl()).groups, { layout, filter, width, nowMs: NOW, isRunning })
const shown = (entries: Entry[]) => entries.map(e => [e.key, e.lines.map(l => (l.dim ? `(${l.text})` : l.text) + (l.aside ? ` @${l.aside}` : ''))])

/* Three groups: a prompt with a reply, a local command with no Agent side,
   and a prompt whose turn used tools. */
function three(): Builder {
  const t = transcript(new Date(2026, 9, 10, 9, 4).getTime())
  t.prompt('CT-SYN first')
  t.reply([text('CT-SYN first answer')])
  t.localCommand('tui', '')
  t.localOutput('CT-SYN fullscreen')
  t.prompt('CT-SYN third')
  t.reply([tool('t1')])
  t.toolResult('t1')
  t.reply([text('CT-SYN third answer')])
  return t
}

test('the filter shows every side, only the User input sides, or only the Agent reply sides', () => {
  const t = three()
  expect(build(t, 'card', 'all').map(e => e.key)).toEqual(['g0.u', 'g0.a', 'g1.u', 'g2.u', 'g2.a'])
  expect(build(t, 'card', 'user').map(e => e.key)).toEqual(['g0.u', 'g1.u', 'g2.u'])
  /* A group with only a User input side is hidden whole. */
  expect(build(t, 'card', 'agent').map(e => e.key)).toEqual(['g0.a', 'g2.a'])
})

test('a running turn shows its Agent side under the Agent filter before it wrote anything', () => {
  const t = transcript()
  t.prompt('CT-SYN just sent')
  expect(build(t, 'card', 'agent', 44, true).map(e => e.key)).toEqual(['g0.a'])
})

test('cards and timelines leave a blank line between groups, compact lists none', () => {
  const t = three()
  const gaps = (layout: Layout, filter: ViewFilter = 'all') => build(t, layout, filter).map(e => e.gapAfter)
  expect(gaps('card')).toEqual([false, true, true, false, false])
  expect(gaps('timeline')).toEqual([false, true, true, false, false])
  expect(gaps('compact')).toEqual([false, false, false, false, false])
  /* Filtered, every entry is a group of its own. */
  expect(gaps('card', 'user')).toEqual([true, true, false])
})

test('compact draws each side on one line, the reply dim, the time kept apart for the left column', () => {
  const t = three()
  const entries = build(t, 'compact', 'all', 30)

  expect(shown(entries)).toEqual([
    ['g0.u', ['CT-SYN first']],
    ['g0.a', ['(CT-SYN first answer)']],
    ['g1.u', ['/tui']],
    ['g2.u', ['CT-SYN third']],
    ['g2.a', ['(1 步 · CT-SYN third…)']],
  ])
  expect(entries.map(e => e.time)).toEqual(['09:05', '', '09:07', '09:09', ''])
  /* The 9-column time and rail and the line fill the width. */
  for (const e of entries) for (const l of e.lines) expect(textCells(l.text) <= 21).toBe(true)
})

test("the time goes to a group's first side the filter shows", () => {
  expect(build(three(), 'compact', 'agent').map(e => e.time)).toEqual(['09:05', '09:09'])
})

test('compact cuts a long prompt and a long reply to one line each, with an ellipsis', () => {
  const t = transcript(new Date(2026, 9, 10, 9, 4).getTime())
  t.prompt('一二三四五六七八九十一二三四五六七八九十')
  t.reply([text('abcdefghijklmnopqrstuvwxyz abcdefghijklmnopqrstuvwxyz')])
  t.prompt('CT-SYN untimed')
  delete t.rows[t.rows.length - 1]?.timestamp

  expect(shown(build(t, 'compact', 'all', 24))).toEqual([
    ['g0.u', ['一二三四五六七…']],
    ['g0.a', ['(abcdefghijklmn…)']],
    ['g1.u', ['CT-SYN untimed']],
  ])
  /* No time to show: none is made up. */
  expect(build(t, 'compact', 'all', 24).map(e => e.time)).toEqual(['09:05', '', ''])
})

test('timeline draws the prompt and the reply, the reply dim, up to two lines each, the time kept apart', () => {
  const t = three()
  const entries = build(t, 'timeline', 'all', 40)

  expect(shown(entries)).toEqual([
    ['g0.u', ['CT-SYN first']],
    ['g0.a', ['(CT-SYN first answer)']],
    ['g1.u', ['/tui']],
    ['g2.u', ['CT-SYN third']],
    ['g2.a', ['(1 步 · CT-SYN third answer)']],
  ])
  expect(entries.map(e => e.time)).toEqual(['09:05', '', '09:07', '09:09', ''])
})

test('timeline folds to the width beside its 9-column time and rail, two less beside a running mark', () => {
  const t = transcript(new Date(2026, 9, 10, 9, 4).getTime())
  t.prompt('一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十')
  t.reply([tool('t1'), text('CT-SYN')])

  expect(shown(build(t, 'timeline', 'all', 28, true))).toEqual([
    ['g0.u', ['一二三四五六七八九', '十一二三四五六七八…']],
    ['g0.a', ['(进行中 · 1 步 ·)', '(CT-SYN)']],
  ])
})

test('the card Layout under a filter draws its sides as the card does unfiltered', () => {
  const t = three()
  expect(shown(build(t, 'card', 'agent'))).toEqual([
    ['g0.a', ['(CT-SYN first answer)']],
    ['g2.a', ['(1 步 · CT-SYN third answer)']],
  ])
})

/* CT-UI-001, CT-UI-002: a stored value chat-toc does not know reads as the
   default. */

test('a stored filter or Layout that is not known reads as all and as cards', () => {
  expect(filterOf('agent')).toBe('agent')
  expect(filterOf(undefined)).toBe('all')
  expect(filterOf('AGENT')).toBe('all')
  expect(filterOf(3)).toBe('all')
  expect(layoutOf('timeline')).toBe('timeline')
  expect(layoutOf(undefined)).toBe('card')
  expect(layoutOf({ layout: 'compact' })).toBe('card')
})

test('the Layout goes from cards to compact to timeline and back to cards', () => {
  expect(nextLayout('card')).toBe('compact')
  expect(nextLayout('compact')).toBe('timeline')
  expect(nextLayout('timeline')).toBe('card')
})
