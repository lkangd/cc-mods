import { expect, test } from 'claude-code/testing'
import { tocModel } from '../hooks/model'
import { newReading, readLines } from '../hooks/regroup'
import type { Reading } from '../hooks/regroup'
import { transcript } from './fixture'
import type { Builder } from './fixture'

/* Reading the transcript as it grows gives, group for group, what reading
   the whole file at once gives, whatever rows open a group. The whole-file
   model is the oracle; these tests never name the opening rules. */

function linesOf(t: Builder, from: number): string {
  return t.rows
    .slice(from)
    .map(r => JSON.stringify(r) + '\n')
    .join('')
}

function feed(reading: Reading, t: Builder, from: number): number {
  readLines(reading, linesOf(t, from))
  return t.rows.length
}

function expectSameAsWhole(reading: Reading, whole: string): void {
  const full = tocModel(whole)
  expect(reading.groups).toEqual(full.groups)
  expect(reading.unreadable).toBe(full.unreadable)
}

test('rows appended on the current branch regroup from the last group only, as the whole file would', () => {
  const t = transcript()
  t.prompt('CT-SYN one')
  t.reply([{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: {} }])
  t.toolResult('toolu_1')
  const reading = newReading()
  let at = feed(reading, t, 0)

  t.reply([{ type: 'text', text: 'done' }])
  t.row({ type: 'user', isMeta: true, message: { role: 'user', content: 'reminder' } })
  t.prompt('CT-SYN two')
  t.reply([{ type: 'text', text: 'two done' }])
  at = feed(reading, t, at)

  expect(reading.lastRegroup).toBe('tail')
  expectSameAsWhole(reading, t.jsonl())
  expect(reading.groups.map(g => g.userText)).toEqual(['CT-SYN one', 'CT-SYN two'])
})

test('a new branch after a rewind regroups the whole chain, and the abandoned groups go', () => {
  const t = transcript()
  const first = t.prompt('CT-SYN keep')
  t.reply([{ type: 'text', text: 'kept' }])
  t.prompt('CT-SYN abandoned')
  t.reply([{ type: 'text', text: 'abandoned answer' }])
  const reading = newReading()
  let at = feed(reading, t, 0)

  t.rewindTo(first)
  t.prompt('CT-SYN new branch')
  at = feed(reading, t, at)

  expect(reading.lastRegroup).toBe('full')
  expectSameAsWhole(reading, t.jsonl())
  expect(reading.groups.map(g => g.userText)).toEqual(['CT-SYN keep', 'CT-SYN new branch'])
})

test('a compaction read after the turns it compacted keeps them, regrouping from the last group only', () => {
  const t = transcript()
  t.prompt('CT-SYN before compact')
  t.reply([{ type: 'text', text: 'early answer' }])
  const reading = newReading()
  let at = feed(reading, t, 0)

  t.command('compact', '', 'local')
  t.compact()
  at = feed(reading, t, at)
  expect(reading.lastRegroup).toBe('tail')
  t.prompt('CT-SYN after compact')
  at = feed(reading, t, at)

  expect(reading.lastRegroup).toBe('tail')
  expectSameAsWhole(reading, t.jsonl())
  expect(reading.groups.map(g => g.userText)).toEqual(['CT-SYN before compact', '/compact', 'CT-SYN after compact'])
})

test('rows that do not reach the chain, and lines that are not rows, keep the groups the whole file gives', () => {
  const t = transcript()
  const one = t.prompt('CT-SYN one')
  const reading = newReading()
  let at = feed(reading, t, 0)

  t.row({ type: 'assistant', isSidechain: true, message: { role: 'assistant', content: [] } })
  t.rewindTo(one)
  at = feed(reading, t, at)
  readLines(reading, 'not json\n')
  t.reply([{ type: 'text', text: 'answer' }])
  at = feed(reading, t, at)

  expect(reading.lastRegroup).toBe('tail')
  expectSameAsWhole(reading, linesOf(t, 0) + 'not json\n')
  expect(reading.unreadable).toBe(1)
})

test('a row written again under a uuid already read regroups the whole chain', () => {
  const t = transcript()
  t.prompt('CT-SYN one')
  const reply = t.reply([{ type: 'text', text: 'first take' }])
  const reading = newReading()
  feed(reading, t, 0)

  const again = JSON.stringify({ ...t.rows[1], uuid: reply, message: { id: 'm', role: 'assistant', content: [{ type: 'text', text: 'second take' }] } })
  readLines(reading, again + '\n')

  expect(reading.lastRegroup).toBe('full')
  expectSameAsWhole(reading, t.jsonl() + again + '\n')
})

/* A deterministic walk through many sessions: random prompts, replies, tool
   calls, rewinds, sidechain rows, reminders and garbage, read in random
   slices. Every slice must leave the same groups as the whole file. */
test('any growth, read in any slices, equals regrouping the whole file', () => {
  let seed = 22
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed % n
  }
  for (let run = 0; run < 40; run++) {
    const t = transcript()
    const extra: string[] = []
    const reading = newReading()
    let at = 0
    let tails = 0
    const uuids: string[] = []
    for (let step = 0; step < 60; step++) {
      const kind = rand(15)
      /* Commands, shell commands, interruptions and API errors too. */
      if (kind === 10) uuids.push(rand(2) === 0 ? t.localCommand('tui', '') : t.localOutput('out'))
      else if (kind === 11) uuids.push(rand(2) === 0 ? t.bash('ls') : t.bashOutput('out'))
      else if (kind === 12) uuids.push(t.command(rand(2) === 0 ? 'review' : 'model', 'x', rand(2) === 0 ? 'prompt' : 'local'))
      else if (kind === 13) uuids.push(t.interrupt(rand(2) === 0))
      else if (kind === 14) uuids.push(t.reply([{ type: 'text', text: 'API Error' }], { isApiErrorMessage: true }))
      else if (kind < 2) uuids.push(t.prompt(`CT-SYN p${run}.${step}`))
      /* The facts' rows too: usage under repeated message ids, file tools,
         Bash diffs and turn durations. */
      else if (kind < 4)
        uuids.push(
          rand(2) === 0
            ? t.reply([{ type: 'text', text: `a${step}` }])
            : t.row({ type: 'assistant', message: { id: `msg_${rand(3)}`, role: 'assistant', content: [{ type: 'text', text: `**a${step}**` }], usage: { output_tokens: rand(900) } } }),
        )
      else if (kind === 4)
        uuids.push(t.reply([{ type: 'tool_use', id: `toolu_${step}`, name: ['Bash', 'Edit', 'Read', 'Write'][rand(4)], input: { file_path: `/p/f${rand(5)}.ts` } }]))
      else if (kind === 5 && rand(2) === 0)
        uuids.push(t.row({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_${step}`, content: '' }] }, toolUseResult: { bashEditDiff: { changedFiles: [`/p/f${rand(5)}.ts`] } } }))
      else if (kind === 5) uuids.push(t.toolResult(`toolu_${step}`))
      else if (kind === 9 && rand(2) === 0) uuids.push(t.row({ type: 'system', subtype: 'turn_duration', durationMs: rand(9000), isMeta: false }))
      else if (kind === 6) uuids.push(t.row({ type: 'user', isMeta: true, message: { role: 'user', content: 'meta' } }))
      else if (kind === 7 && uuids.length > 0 && rand(3) === 0) t.rewindTo(uuids[rand(uuids.length)] ?? null)
      else if (kind === 8 && rand(4) === 0) uuids.push(t.compact())
      else if (kind === 8) t.row({ type: 'assistant', isSidechain: true, message: { role: 'assistant', content: [] } })
      else uuids.push(t.row({ type: 'system', subtype: 'informational', content: 'note' }))
      if (rand(4) === 0) {
        const text = linesOf(t, at) + (rand(5) === 0 ? '{"broken"\n' : '')
        if (text.endsWith('{"broken"\n')) extra.push('{"broken"\n')
        readLines(reading, text)
        if (reading.lastRegroup === 'tail') tails++
        at = t.rows.length
      }
    }
    readLines(reading, linesOf(t, at))
    const full = tocModel(t.jsonl() + extra.join(''))
    expect(reading.groups).toEqual(full.groups)
    expect(reading.unreadable).toBe(full.unreadable)
    expect(tails).toBeGreaterThan(0)
  }
})
