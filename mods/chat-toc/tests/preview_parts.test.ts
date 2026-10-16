import { expect, test } from 'claude-code/testing'
import { capTexts, durationText, filesLine, markdownParts, metaLine, previewBody, previewPlan, previewRows, shownPath, tokensText } from '../hooks/preview'
import { tocModel } from '../hooks/model'
import type { TurnGroup } from '../hooks/groups'
import { setLanguage } from '../hooks/text'
import { transcript } from './fixture'

/* The preview's parts as pure functions (spec §3, §4): its words, its size
   and what it cuts. */

const NOW = new Date(2026, 9, 16, 18, 0).getTime()

test('durations read as the spec writes them, in both languages', () => {
  setLanguage('en')
  expect([0, 999, 45_000, 200_000, 180_000, 3_900_000, 3_600_000].map(durationText)).toEqual(['<1s', '<1s', '45s', '3m 20s', '3m', '1h 5m', '1h'])
  setLanguage('zh')
  expect([500, 45_000, 200_000, 3_900_000].map(durationText)).toEqual(['<1 秒', '45 秒', '3 分 20 秒', '1 小时 5 分'])
})

test('output tokens under 1000 as is, then k and M', () => {
  expect([0, 999, 1_000, 3_456, 12_345, 999_999, 1_234_567, 25_000_000].map(tokensText)).toEqual(['0', '999', '1k', '3.5k', '12k', '1M', '1.2M', '25M'])
})

function groupOf(build: (t: ReturnType<typeof transcript>) => void, start = new Date(2026, 9, 16, 14, 31).getTime()): TurnGroup {
  const t = transcript(start)
  build(t)
  return tocModel(t.jsonl()).groups[0]!
}

const timed = (t: ReturnType<typeof transcript>) => {
  t.prompt('CT-SYN timed')
  t.row({ type: 'assistant', message: { id: 'm1', role: 'assistant', content: [{ type: 'tool_use', id: 'x', name: 'Bash', input: {} }], usage: { output_tokens: 3_500 } } })
  t.reply([{ type: 'text', text: 'done' }])
  t.row({ type: 'system', subtype: 'turn_duration', durationMs: 200_000 })
}

test('the meta line: the date always, today too, the time, steps, duration and tokens', () => {
  setLanguage('en')
  expect(metaLine(groupOf(timed), false, NOW)).toBe('Oct 16 14:32 · 1 step · 3m 20s · 3.5k out')
  setLanguage('zh')
  expect(metaLine(groupOf(timed), false, NOW)).toBe('10月16日 14:32 · 1 步 · 3 分 20 秒 · 输出 3.5k')
})

test('the meta line is one row: fields that do not fit the width go from the end, whole', () => {
  setLanguage('zh')
  const group = groupOf(t => {
    timed(t)
    t.row({ type: 'assistant', message: { id: 'm9', role: 'assistant', content: [{ type: 'tool_use', id: 'y', name: 'Bash', input: {} }, { type: 'tool_use', id: 'z', name: 'Bash', input: {} }, { type: 'tool_use', id: 'w', name: 'Bash', input: {} }] } })
  })
  /* 46 cells whole. */
  expect(metaLine(group, false, NOW, 46)).toBe('10月16日 14:32 · 4 步 · 3 分 20 秒 · 输出 3.5k')
  expect(metaLine(group, false, NOW, 45)).toBe('10月16日 14:32 · 4 步 · 3 分 20 秒')
  expect(metaLine(group, false, NOW, 10)).toBe('10月16日 14:32')
})

test('the meta line says the state only when not finished, and leaves out what the file does not state', () => {
  setLanguage('en')
  const plain = groupOf(t => {
    t.prompt('CT-SYN plain')
    t.reply([{ type: 'text', text: 'ok' }])
  })
  expect(metaLine(plain, false, NOW)).toBe('Oct 16 14:32')
  expect(metaLine(plain, true, NOW)).toBe('Oct 16 14:32 · Running')
  const cut = groupOf(t => {
    t.prompt('CT-SYN cut')
    t.interrupt()
  })
  expect(metaLine(cut, false, NOW)).toBe('Oct 16 14:32 · Interrupted')
  const lastYear = groupOf(t => t.prompt('CT-SYN old'), new Date(2025, 0, 2, 9, 0).getTime())
  expect(metaLine(lastYear, false, NOW)).toBe('Jan 2, 2025 09:01')
})

test('a path under the working directory shows relative to it, else absolute with ~ for home', () => {
  const at = { cwd: '/Users/me/project', home: '/Users/me' }
  expect(shownPath('/Users/me/project/hooks/pane.tsx', at)).toBe('hooks/pane.tsx')
  expect(shownPath('/Users/me/project-two/a.ts', at)).toBe('~/project-two/a.ts')
  expect(shownPath('/etc/hosts', at)).toBe('/etc/hosts')
  expect(shownPath('/Users/me/a.ts', { cwd: undefined, home: undefined })).toBe('/Users/me/a.ts')
})

test('the files line names the changed files that fit, counts the rest, and counts the read ones', () => {
  setLanguage('en')
  const at = { cwd: '/p', home: '/h' }
  const facts = { changed: ['/p/register.tsx', '/p/pane.tsx', '/p/hooks/text.ts'], read: ['/p/a', '/p/b', '/p/c', '/p/d', '/p/e'] }
  expect(filesLine(facts, at, 44)).toBe('changed register.tsx, pane.tsx +1 · read 5')
  expect(filesLine(facts, at, 56)).toBe('changed register.tsx, pane.tsx, hooks/text.ts · read 5')
  expect(filesLine({ changed: [], read: ['/p/a'] }, at, 44)).toBe('read 1')
  expect(filesLine({ changed: ['/p/a'], read: [] }, at, 44)).toBe('changed a')
  expect(filesLine({ changed: [], read: [] }, at, 44)).toBeUndefined()
  setLanguage('zh')
  expect(filesLine(facts, at, 44)).toBe('改 register.tsx, pane.tsx +1 · 读 5')
})

test('the region is 40% of the rows left after the head and the footer, held to 4..14, the rule included', () => {
  expect([10, 20, 30, 40, 60].map(previewRows)).toEqual([4, 8, 12, 14, 14])
})

test('when rows run short the Minimap goes first, then the preview shrinks to 4 rows, then it leaves one line; the list keeps 8', () => {
  // 30 rows left: preview 12, Minimap 3, list 15
  expect(previewPlan({ rows: 30, groups: 5, isShown: true })).toEqual({ preview: 12, state: 'shown', hasBars: true })
  // 22 left: preview 9; with the Minimap the list would have 10
  expect(previewPlan({ rows: 22, groups: 5, isShown: true })).toEqual({ preview: 9, state: 'shown', hasBars: true })
  // 18 left: 7 + 3 + 8 = 18 keeps the Minimap; 17 does not
  expect(previewPlan({ rows: 18, groups: 5, isShown: true })).toEqual({ preview: 7, state: 'shown', hasBars: true })
  expect(previewPlan({ rows: 17, groups: 5, isShown: true })).toEqual({ preview: 7, state: 'shown', hasBars: false })
  // 14 left: the preview shrinks to fit the list's 8, down to 4
  expect(previewPlan({ rows: 14, groups: 5, isShown: true })).toEqual({ preview: 6, state: 'shown', hasBars: false })
  expect(previewPlan({ rows: 12, groups: 5, isShown: true })).toEqual({ preview: 4, state: 'shown', hasBars: false })
  expect(previewPlan({ rows: 11, groups: 5, isShown: true })).toEqual({ preview: 1, state: 'noRoom', hasBars: false })
  // hidden, one line; the Minimap as before
  expect(previewPlan({ rows: 12, groups: 5, isShown: false })).toEqual({ preview: 1, state: 'hidden', hasBars: true })
  // one group draws no Minimap; no group, no preview
  expect(previewPlan({ rows: 30, groups: 1, isShown: true })).toEqual({ preview: 12, state: 'shown', hasBars: false })
  expect(previewPlan({ rows: 30, groups: 0, isShown: true })).toEqual({ preview: 0, state: 'none', hasBars: false })
})

const body = (input: string, agent: string | undefined, files: string | undefined, rows: number, width = 20) =>
  previewBody({ meta: 'META', input, agent, files, rows, width })

test('a short group fills the region from the top and leaves blank rows', () => {
  expect(body('hello', 'world', 'changed a', 8)).toEqual({
    meta: 'META',
    user: ['hello'],
    agent: { text: 'world', rows: 1 },
    files: 'changed a',
    more: 0,
    blank: 1,
  })
  expect(body('/tui', undefined, undefined, 4)).toEqual({ meta: 'META', user: ['/tui'], agent: undefined, files: undefined, more: 0, blank: 0 })
})

test('past the region the files line goes first, then the Agent text, then the User input; the meta line stays', () => {
  const long = 'one\ntwo\nthree\nfour\nfive'
  // 8 rows: rule, meta, then 6: everything but files is 2 + 6 = 8 rows, so cut
  expect(body('hi', long, 'changed a', 8)).toEqual({ meta: 'META', user: ['hi'], agent: { text: 'one\ntwo', rows: 2 }, files: undefined, more: 4, blank: 0 })
  // the Agent label row stays when its text does not fit
  expect(body('hi', 'one', 'changed a', 6)).toEqual({ meta: 'META', user: ['hi'], agent: { text: '', rows: 0 }, files: undefined, more: 2, blank: 0 })
  // a long User input takes the room first
  expect(body(long, 'answer', undefined, 6)).toEqual({ meta: 'META', user: ['one', 'two'], agent: undefined, files: undefined, more: 4, blank: 0 })
  // at 4 rows only the User label is left beside the more line
  expect(body(long, 'answer', 'changed a', 4)).toEqual({ meta: 'META', user: [], agent: undefined, files: undefined, more: 7, blank: 0 })
})

test('a User input is folded to the width, lines kept as typed', () => {
  expect(body('abcdefghij klmnopqrst uvw\n\nend', undefined, undefined, 10, 12).user).toEqual(['abcdefghij', 'klmnopqrst', 'uvw', '', 'end'])
})

test('the Agent text is cut at the rows it gets, whole source lines first, never past the Markdown limit', () => {
  const cut = body('q', 'a long first paragraph that wraps\nsecond', undefined, 8, 12)
  expect(cut.agent?.rows).toBe(2)
  expect(cut.agent?.text).toBe('a long first paragraph')
  const huge = body('q', 'x'.repeat(30_000), undefined, 14, 3_000)
  expect((huge.agent?.text.length ?? 0) <= 10_000).toBe(true)
})

/* The expanded preview (spec §3 "Expanded", "Text cap"). */

test('the expanded text is whole while the User input and the last text together stay within the cap', () => {
  expect(capTexts('ab', 'cd', 10)).toEqual({ input: { shown: 'ab', left: 0 }, agent: { shown: 'cd', left: 0 } })
  expect(capTexts('ab', undefined, 10)).toEqual({ input: { shown: 'ab', left: 0 }, agent: undefined })
})

test('past the cap a long part gives way and a short one stays whole; two long parts take half each', () => {
  const long = 'x'.repeat(200_000)
  const capped = capTexts(long, 'short reply', 60_000)
  expect(capped.agent).toEqual({ shown: 'short reply', left: 0 })
  expect(capped.input.shown.length).toBe(60_000 - 'short reply'.length)
  expect(capped.input.left).toBe(200_000 - capped.input.shown.length)

  const both = capTexts('u'.repeat(50_000), 'a'.repeat(40_000), 60_000)
  expect([both.input.shown.length, both.input.left, both.agent?.shown.length, both.agent?.left]).toEqual([30_000, 20_000, 30_000, 10_000])
})

test('a text longer than one Markdown takes is split over several, at a blank line, else a line break, else anywhere', () => {
  expect(markdownParts('short', 20)).toEqual(['short'])
  expect(markdownParts('para one\n\npara two\n\npara three', 20)).toEqual(['para one\n\npara two\n', 'para three'])
  expect(markdownParts('aaaa\nbbbb\ncccc', 10)).toEqual(['aaaa\nbbbb', 'cccc'])
  expect(markdownParts('x'.repeat(25), 10)).toEqual(['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(5)])
  const parts = markdownParts('y'.repeat(25_000))
  expect(parts.map(p => p.length)).toEqual([10_000, 10_000, 5_000])
})

test('a code block split over two Markdowns is closed in the first and opened again in the next', () => {
  expect(markdownParts('```ts\nline1\nline2\nline3\n```', 20)).toEqual(['```ts\nline1\n```', '```ts\nline2\n```', '```ts\nline3\n```'])
})

test('the cap never splits a character, and counts what it leaves out in characters', () => {
  expect(capTexts('ab😀😀', undefined, 3).input).toEqual({ shown: 'ab', left: 2 })
})
