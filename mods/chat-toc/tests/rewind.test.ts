import { expect, test } from 'claude-code/testing'
import { rewoundFrom } from '../hooks/rewind'
import type { HostMessage } from '../hooks/rewind'
import { newReading, readLines } from '../hooks/regroup'
import { hostMessagesOf as messagesOf, rewoundTo, transcript } from './fixture'
import type { Builder, Row } from './fixture'

/* CT-LIFE-004 at the seam: a rewind (Esc Esc, restore the conversation)
   writes nothing to the file, but the host's own messages lose the turn
   rewound to and everything after it. Lining the host's user turns up with
   the file's from the end finds the first group the host no longer holds. */

const text = (t: string): Row[] => [{ type: 'text', text: t }]

function read(t: Builder) {
  return readLines(newReading(), t.jsonl())
}

function session(prompts: string[]): Builder {
  const t = transcript()
  for (const p of prompts) {
    t.prompt(p)
    t.reply(text(`${p} answer`))
  }
  return t
}

test('the groups from the prompt rewound to on are no longer held', () => {
  const t = session(['CT-SYN one', 'CT-SYN two', 'CT-SYN three', 'CT-SYN four'])
  const reading = read(t)

  expect(rewoundFrom(reading.groups, reading.chain, rewoundTo(messagesOf(t), 'CT-SYN three'))).toEqual({ kind: 'from', group: 2 })
})

test('messages that hold every turn the file has hide nothing', () => {
  const t = session(['CT-SYN one', 'CT-SYN two'])
  const reading = read(t)

  expect(rewoundFrom(reading.groups, reading.chain, messagesOf(t))).toEqual({ kind: 'all' })
})

test('a rewind to the first prompt leaves nothing held', () => {
  const t = session(['CT-SYN one', 'CT-SYN two'])
  const reading = read(t)

  expect(rewoundFrom(reading.groups, reading.chain, [])).toEqual({ kind: 'from', group: 0 })
})

test('a turn whose last user message is a tool result, or a shell command and its output, is still held', () => {
  const t = transcript()
  t.prompt('CT-SYN tools')
  t.reply([{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: {} }])
  t.toolResult('toolu_1')
  t.reply(text('CT-SYN tools done'))
  t.bash('echo hi')
  t.bashOutput('hi')
  t.prompt('CT-SYN after')
  t.reply(text('CT-SYN after answer'))
  const reading = read(t)

  expect(rewoundFrom(reading.groups, reading.chain, rewoundTo(messagesOf(t), 'CT-SYN after'))).toEqual({ kind: 'from', group: 2 })
})

test('a local command after the last turn held goes with the rewound turn', () => {
  const t = session(['CT-SYN one'])
  t.localCommand('tui', '')
  t.localOutput('ok')
  t.prompt('CT-SYN two')
  t.reply(text('CT-SYN two answer'))
  const reading = read(t)
  expect(reading.groups.length).toBe(3)

  expect(rewoundFrom(reading.groups, reading.chain, rewoundTo(messagesOf(t), 'CT-SYN two'))).toEqual({ kind: 'from', group: 1 })
})

test('after a compaction the turns before it stay, and a rewind past it is found from the summary on', () => {
  const t = session(['CT-SYN one', 'CT-SYN two'])
  t.compact()
  t.prompt('CT-SYN three')
  t.reply(text('CT-SYN three answer'))
  t.prompt('CT-SYN four')
  t.reply(text('CT-SYN four answer'))
  const reading = read(t)

  expect(rewoundFrom(reading.groups, reading.chain, rewoundTo(messagesOf(t), 'CT-SYN four'))).toEqual({ kind: 'from', group: 3 })
  expect(rewoundFrom(reading.groups, reading.chain, rewoundTo(messagesOf(t), 'CT-SYN three'))).toEqual({ kind: 'from', group: 2 })
})

test('messages that do not line up with the file, as a compaction not written yet, say nothing', () => {
  const t = session(['CT-SYN one', 'CT-SYN two'])
  const reading = read(t)
  const compacted: HostMessage[] = [{ role: 'user', text: 'This session is being continued from a previous conversation. Summary: new.' }]

  expect(rewoundFrom(reading.groups, reading.chain, compacted)).toEqual({ kind: 'unknown' })
})

test('the same prompt typed several times is told apart by where the messages end', () => {
  const t = session(['CT-SYN same', 'CT-SYN same', 'CT-SYN same'])
  const reading = read(t)
  const messages = messagesOf(t)

  expect(rewoundFrom(reading.groups, reading.chain, messages.slice(0, 4))).toEqual({ kind: 'from', group: 2 })
  expect(rewoundFrom(reading.groups, reading.chain, messages.slice(0, 2))).toEqual({ kind: 'from', group: 1 })
})

test('messages cut to the newest 4096 line up from their end', () => {
  const prompts = Array.from({ length: 2100 }, (_, i) => `CT-SYN ${i}`)
  const t = session(prompts)
  const reading = read(t)
  const all = messagesOf(t)
  const kept = all.slice(0, 2 * 2050)

  expect(rewoundFrom(reading.groups, reading.chain, kept.slice(-4096))).toEqual({ kind: 'from', group: 2050 })
})

test('whitespace the host joins text blocks with does not matter', () => {
  const t = transcript()
  t.prompt('CT-SYN one', { message: { role: 'user', content: [{ type: 'text', text: 'CT-SYN' }, { type: 'text', text: 'one' }] } })
  t.reply(text('a'))
  t.prompt('CT-SYN two')
  t.reply(text('b'))
  const reading = read(t)

  expect(rewoundFrom(reading.groups, reading.chain, [{ role: 'user', text: 'CT-SYN one' }, { role: 'assistant', text: 'a' }])).toEqual({ kind: 'from', group: 1 })
})
