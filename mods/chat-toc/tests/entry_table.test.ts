import { expect, test } from 'claude-code/testing'
import { entriesOf, firstEntryFrom } from '../hooks/entries'
import type { EntryOptions } from '../hooks/entries'
import { tocModel } from '../hooks/model'
import { newReading, readLines } from '../hooks/regroup'
import { entryHeight } from '../hooks/pane'
import { entryOfGroup, entryTable, narrowedTable, newEntryCache } from '../hooks/table'
import type { Layout, ViewFilter } from '../hooks/view'
import { transcript } from './fixture'
import type { Builder, Row } from './fixture'
import { setLanguage } from '../hooks/text'

/* These tests check the Chinese words (text.ts). */
setLanguage('zh')

/* The pane's entry table: entries kept per group and the list rebuilt only
   when the groups, the width, the View filter or the Layout change, so a
   long session's redraw does not fold every entry again (MVP spec §7). */

const NOW = new Date(2026, 9, 10, 18, 0).getTime()
const tool = (id: string): Row => ({ type: 'tool_use', id, name: 'Bash', input: {} })
const text = (t: string): Row => ({ type: 'text', text: t })
const options = (layout: Layout = 'card', filter: ViewFilter = 'all', width = 44, isRunning = false): EntryOptions => ({
  layout,
  filter,
  width,
  nowMs: NOW,
  isRunning,
})

function session(turns: number): Builder {
  const t = transcript(new Date(2026, 9, 10, 9, 0).getTime())
  for (let i = 0; i < turns; i++) {
    if (i % 5 === 3) {
      t.localCommand('tui', '')
      t.localOutput('CT-SYN fullscreen')
      continue
    }
    t.prompt(`CT-SYN prompt ${i}，一段会折行的较长的文字，用来看看折行和截断是否一致`)
    t.reply([tool(`t${i}`)])
    t.toolResult(`t${i}`)
    if (i % 4 !== 1) t.reply([text(`CT-SYN answer ${i}`)])
  }
  return t
}

test('the table lists what entriesOf lists, with heights and each group’s first entry', () => {
  const groups = tocModel(session(23).jsonl()).groups
  for (const layout of ['card', 'compact', 'timeline'] as const) {
    for (const filter of ['all', 'user', 'agent'] as const) {
      const table = entryTable(newEntryCache(), groups, options(layout, filter))
      const listed = entriesOf(groups, options(layout, filter))
      expect(table.entries).toEqual(listed)
      expect(table.heights).toEqual(listed.map((_, i) => entryHeight(listed, i)))
      expect(table.keys).toEqual(listed.map(e => e.key))
      listed.forEach((e, i) => expect(table.indexOf.get(e.key)).toBe(i))
      groups.forEach((_, g) => expect(entryOfGroup(table, g)).toBe(firstEntryFrom(listed, g)))
    }
  }
})

test('narrowed to every group, the table lists as the whole one does', () => {
  const groups = tocModel(session(23).jsonl()).groups
  const every = groups.map((_, g) => g)
  for (const layout of ['card', 'compact', 'timeline'] as const) {
    for (const filter of ['all', 'user', 'agent'] as const) {
      const table = entryTable(newEntryCache(), groups, options(layout, filter))
      expect(narrowedTable(table, every)).toEqual(table)
    }
  }
})

test('a session read a few rows at a time, a turn starting and ending, lists at every step what entriesOf lists', () => {
  const lines = session(23).jsonl().split('\n').filter(Boolean)
  for (const filter of ['all', 'agent'] as const) {
    for (const layout of ['card', 'compact'] as const) {
      const reading = newReading()
      const cache = newEntryCache()
      for (let at = 0; at < lines.length; at += 3) {
        readLines(reading, lines.slice(at, at + 3).join('\n') + '\n')
        for (const isRunning of at % 2 === 0 ? [false, true] : [true, false]) {
          const o = options(layout, filter, 44, isRunning)
          const table = entryTable(cache, reading.groups, o)
          const listed = entriesOf(reading.groups, o)
          expect(table.entries).toEqual(listed)
          expect(table.heights).toEqual(listed.map((_, i) => entryHeight(listed, i)))
          expect(table.keys).toEqual(listed.map(e => e.key))
          expect(table.indexOf.size).toBe(listed.length)
          listed.forEach((e, i) => expect(table.indexOf.get(e.key)).toBe(i))
          reading.groups.forEach((_, g) => expect(entryOfGroup(table, g)).toBe(firstEntryFrom(listed, g)))
        }
      }
    }
  }
})

test('a redraw with nothing changed reuses the table', () => {
  const groups = tocModel(session(8).jsonl()).groups
  const cache = newEntryCache()
  const first = entryTable(cache, groups, options())
  expect(entryTable(cache, groups, options())).toBe(first)
})

test('a read that grows the last group folds only that group again', () => {
  const t = session(8)
  t.prompt('CT-SYN last prompt')
  t.reply([tool('tl')])
  const reading = newReading()
  const before = t.jsonl()
  readLines(reading, before)
  const cache = newEntryCache()
  const first = entryTable(cache, reading.groups, options())
  t.toolResult('tl')
  t.reply([text('CT-SYN last answer')])
  readLines(reading, t.jsonl().slice(before.length))
  const second = entryTable(cache, reading.groups, options())
  expect(second).not.toBe(first)
  expect(second.entries).toEqual(entriesOf(reading.groups, options()))
  const last = reading.groups.length - 1
  for (let i = 0; i < first.entries.length; i++) {
    const was = first.entries[i]!
    if (was.groupIndex === last) continue
    /* Same group, same entry: not folded again. */
    expect(second.entries[i]!.lines).toBe(was.lines)
  }
  expect(second.entries.at(-1)!.lines.map(l => l.text)).toContain('1 步 · CT-SYN last answer')
})

test('the width, the filter, the Layout and a turn starting each rebuild the list', () => {
  const groups = tocModel(session(8).jsonl()).groups
  const cache = newEntryCache()
  const card = entryTable(cache, groups, options())
  const running = entryTable(cache, groups, options('card', 'all', 44, true))
  expect(running.entries).toEqual(entriesOf(groups, options('card', 'all', 44, true)))
  expect(running.entries.at(-1)!.lines[0]!.text).toContain('进行中')
  /* Only the running group was folded again. */
  expect(running.entries[0]!.lines).toBe(card.entries[0]!.lines)
  const narrow = entryTable(cache, groups, options('card', 'all', 30))
  expect(narrow.entries).toEqual(entriesOf(groups, options('card', 'all', 30)))
  const user = entryTable(cache, groups, options('card', 'user', 30))
  expect(user.entries).toEqual(entriesOf(groups, options('card', 'user', 30)))
  const timeline = entryTable(cache, groups, options('timeline', 'user', 30))
  expect(timeline.entries).toEqual(entriesOf(groups, options('timeline', 'user', 30)))
})

test('groups grouped again from the whole file keep their entries when they show the same', () => {
  const t = session(8)
  const cache = newEntryCache()
  const first = entryTable(cache, tocModel(t.jsonl()).groups, options())
  const again = entryTable(cache, tocModel(t.jsonl()).groups, options())
  expect(again.entries).toEqual(first.entries)
  expect(again.entries[0]!.lines).toBe(first.entries[0]!.lines)
})

test('an empty list has no entries and no first entry for any group', () => {
  const table = entryTable(newEntryCache(), [], options())
  expect(table.entries).toEqual([])
  expect(table.firstOfGroup).toEqual([])
})
