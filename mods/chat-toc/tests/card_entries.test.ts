import { expect, test } from 'claude-code/testing'
import { cardUserEntry, formatTime } from '../hooks/entries'
import { wrapCells } from '../hooks/cells'

/* The card Layout's User input side: a dim header line saying who and when,
   then up to two lines of the prompt, each line cut to the pane's width. */

const NOW = new Date(2026, 9, 10, 18, 0).getTime()

test('a time this year reads month, day and minute of the local clock', () => {
  const at = new Date(2026, 9, 10, 9, 5).toISOString()
  expect(formatTime(at, NOW)).toBe('10月10日 09:05')
})

test('a time from another year says the year', () => {
  const at = new Date(2025, 0, 2, 23, 59).toISOString()
  expect(formatTime(at, NOW)).toBe('2025年1月2日 23:59')
})

test('no time, or one that does not parse, shows nothing', () => {
  expect(formatTime(undefined, NOW)).toBe('')
  expect(formatTime('not a time', NOW)).toBe('')
})

test('the header says who and when, then the prompt', () => {
  const entry = cardUserEntry(
    { openerUuid: 'u1', userText: 'CT-SYN short', timestamp: new Date(2026, 9, 10, 9, 5).toISOString(), rowUuids: ['u1'] },
    0,
    40,
    NOW,
  )
  expect(entry.key).toBe('g0.u')
  expect(entry.lines).toEqual([
    { text: '你 · 10月10日 09:05', dim: true },
    { text: 'CT-SYN short', dim: false },
  ])
})

test('a prompt without a time says only who', () => {
  const entry = cardUserEntry({ openerUuid: 'u1', userText: 'CT-SYN', timestamp: undefined, rowUuids: ['u1'] }, 3, 40, NOW)
  expect(entry.lines[0]).toEqual({ text: '你', dim: true })
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
