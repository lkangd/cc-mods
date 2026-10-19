import { expect, test } from 'claude-code/testing'
import { cardEntries } from '../hooks/entries'
import type { Entry } from '../hooks/entries'
import { textCells, wrapCells } from '../hooks/cells'
import { tocModel } from '../hooks/model'
import { transcript } from './fixture'
import type { Builder, Row } from './fixture'
import { setLanguage } from '../hooks/text'

/* These tests check the Chinese words (text.ts). */
setLanguage('zh')

/* The card Layout: each side of a Turn group up to two lines beside a
   3-column rail, the User input's time at the right of its first line, the
   Agent reply's state and reply one dim run; every line cut to the width. */

const NOW = new Date(2026, 9, 10, 18, 0).getTime()
const WIDTH = 44

const tool = (id: string): Row => ({ type: 'tool_use', id, name: 'Bash', input: {} })
const text = (t: string): Row => ({ type: 'text', text: t })

const entriesOf = (t: Builder, isRunning = false, width = WIDTH) => cardEntries(tocModel(t.jsonl()).groups, width, NOW, isRunning)
const shown = (entries: Entry[]) => entries.map(e => [e.key, e.lines.map(l => (l.dim ? `(${l.text})` : l.text) + (l.aside ? ` @${l.aside}` : ''))])

test('the User input side is the prompt, its time at the right of the first line', () => {
  const t = transcript(new Date(2026, 9, 10, 9, 4).getTime())
  t.prompt('CT-SYN short')

  expect(shown(entriesOf(t))).toEqual([['g0.u', ['CT-SYN short @09:05']]])
})

test('a transcript without timestamps shows no time, and none is made up', () => {
  const t = transcript()
  t.prompt('CT-SYN untimed')
  for (const row of t.rows) delete row.timestamp

  expect(entriesOf(t)[0]?.lines).toEqual([{ text: 'CT-SYN untimed', dim: false }])
})

test('the Agent reply side is one dim run: the steps, then the reply', () => {
  const t = transcript(new Date(2026, 9, 10, 9, 4).getTime())
  const asked = t.prompt('CT-SYN fix it')
  t.reply([tool('t1'), tool('t2')])
  t.toolResult('t1')
  t.toolResult('t2')
  t.reply([tool('t3')])
  t.toolResult('t3')
  const answer = t.reply([text('CT-SYN fixed the failing check')])

  const entries = entriesOf(t)

  expect(shown(entries)).toEqual([
    ['g0.u', ['CT-SYN fix it @09:05']],
    ['g0.a', ['(3 步 · CT-SYN fixed the failing check)']],
  ])
  expect(entries.map(e => [e.side, e.jumpUuid])).toEqual([
    ['user', asked],
    ['agent', answer],
  ])
})

test('a reply without steps is the reply alone', () => {
  const t = transcript()
  t.prompt('CT-SYN hi')
  t.reply([text('CT-SYN hello')])

  expect(entriesOf(t)[1]?.lines.map(l => l.text)).toEqual(['CT-SYN hello'])
})

test('a turn without a reply says so, with its steps when it took any', () => {
  const t = transcript()
  t.prompt('CT-SYN tools only')
  t.reply([tool('t1'), tool('t2')])
  t.toolResult('t1')
  t.toolResult('t2')
  t.prompt('CT-SYN thought only')
  t.reply([{ type: 'thinking', thinking: 'CT-SYN' }])

  const agent = entriesOf(t).filter(e => e.side === 'agent')

  expect(agent.map(e => e.lines.map(l => l.text))).toEqual([['2 步 · 无文字回复'], ['无文字回复']])
})

test('an interrupted turn and a turn that ended in an API error say so, with what the file holds', () => {
  const t = transcript()
  t.prompt('CT-SYN stop')
  t.reply([tool('t1')])
  t.interrupt(true)
  t.prompt('CT-SYN fail')
  t.reply([tool('t2'), tool('t3')])
  t.toolResult('t2')
  t.toolResult('t3')
  t.reply([text('API Error: CT-SYN overloaded')], { isApiErrorMessage: true })

  const agent = entriesOf(t).filter(e => e.side === 'agent')

  expect(agent.map(e => e.lines.map(l => l.text))).toEqual([['已中断 · 1 步'], ['出错 · 2 步 · API Error: CT-SYN', 'overloaded']])
})

test('while a turn runs, the last group is in progress, its steps as far as the file has them', () => {
  const t = transcript()
  t.prompt('CT-SYN earlier')
  t.reply([text('CT-SYN earlier answer')])
  t.prompt('CT-SYN working')
  t.reply([text('CT-SYN looking'), tool('t1')])

  const agent = entriesOf(t, true).filter(e => e.side === 'agent')

  expect(agent.map(e => e.lines.map(l => l.text))).toEqual([['CT-SYN earlier answer'], ['进行中 · 1 步']])
  /* The running side is marked for the pane, which draws ◐ beside it. */
  expect(agent.map(e => e.isRunning)).toEqual([false, true])
})

test('a turn that has just started shows in progress before the agent has written anything', () => {
  const t = transcript()
  t.prompt('CT-SYN just sent')

  expect(shown(entriesOf(t, true)).map(([key]) => key)).toEqual(['g0.u', 'g0.a'])
  expect(entriesOf(t, true)[1]?.lines).toEqual([{ text: '进行中', dim: true }])
  expect(shown(entriesOf(t, false)).map(([key]) => key)).toEqual(['g0.u'])
})

test('a local command and a shell command without agent work draw only the User input side', () => {
  const t = transcript()
  t.localCommand('tui', '')
  t.localOutput('CT-SYN fullscreen')
  t.bash('echo CT-SYN')
  t.bashOutput('CT-SYN')

  expect(entriesOf(t).map(e => [e.key, e.lines[0]?.text])).toEqual([
    ['g0.u', '/tui'],
    ['g1.u', '!echo CT-SYN'],
  ])
})

/* CT-TURN-003: lines are folded by terminal cells, wide characters taking
   two, and the second line of a side cut with an ellipsis. */

test('a long prompt and a long reply show two lines each, the second ending in an ellipsis', () => {
  const t = transcript()
  t.prompt('一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十')
  t.reply([text('😀😀😀😀😀😀abcdefghijklmnopqrstuvwxyz 0123456789')])

  /* 22 columns: 19 beside the rail; the prompt's first line leaves 6 for
     its time. */
  expect(entriesOf(t, false, 22).map(e => e.lines.map(l => l.text))).toEqual([
    ['一二三四五六', '七八九十一二三四五…'],
    ['😀😀😀😀😀😀abcdefg', 'hijklmnopqrstuvwxy…'],
  ])
})

test('a long prompt shows two lines, the second ending in an ellipsis', () => {
  expect(wrapCells('abcdefghijklmnopqrstuvwxyz', 10, 2)).toEqual(['abcdefghij', 'klmnopqrs…'])
})

test('a short prompt is not given an ellipsis', () => {
  expect(wrapCells('abcdefghijklm', 10, 2)).toEqual(['abcdefghij', 'klm'])
  expect(wrapCells('abcdefghijklmnopqrst', 10, 2)).toEqual(['abcdefghij', 'klmnopqrst'])
})

test('wide characters take two cells', () => {
  expect(wrapCells('一二三四五六七八九十', 8, 2)).toEqual(['一二三四', '五六七…'])
  expect(wrapCells('ab一二三', 5, 2)).toEqual(['ab一', '二三'])
})

/* CT-TURN-003: the host draws an emoji-presentation character two cells
   wide even below the astral planes (✨ U+2728, ✅, ⭐, ⚡), so a line of
   them folds where the terminal does. */
test('emoji drawn as emoji by default take two cells, as the host draws them', () => {
  expect(textCells('✨✅⭐⚡⌛')).toBe(10)
  expect(wrapCells('✨✨✨✨✨✨', 8, 2)).toEqual(['✨✨✨✨', '✨✨'])
  /* Text-presentation symbols stay one cell. */
  expect(textCells('↳·•✓★')).toBe(5)
})
