import { expect, test } from 'claude-code/testing'
import { appendRow, drawHint, entryTexts, host, mountPane, start } from './host'
import { hostMessagesOf, rewoundTo, transcript } from './fixture'
import type { Builder } from './fixture'

/* CT-LIFE-004: after a rewind the pane drops the turn rewound to and every
   turn after it at once, from the host's own messages, with nothing written
   to the file. Every drawing of the hint line reads `$.session.turns()`;
   only a drop asks for the messages. The file decides again once it grows. */

function session(prompts: string[]): { t: Builder; replies: string[] } {
  const t = transcript()
  const replies: string[] = []
  for (const p of prompts) {
    t.prompt(p)
    replies.push(t.reply([{ type: 'text', text: `${p} answer` }]))
  }
  return { t, replies }
}

const PROMPTS = ['CT-SYN one', 'CT-SYN two', 'CT-SYN three', 'CT-SYN four']

test('hint-line drawings with the turn count unchanged never ask for the messages', async ($, on) => {
  const { t } = session(PROMPTS)
  const world = host(on, t.jsonl())
  world.messages = hostMessagesOf(t)
  await start($, world)
  await mountPane($)
  for (let i = 0; i < 5; i++) await drawHint($, true, 160 + i)
  await world.clock.settle()

  expect(world.messageCalls).toBe(0)
})

test('a drop in the turn count drops the turn rewound to and the ones after it, with no read', async ($, on) => {
  const { t } = session(PROMPTS)
  const world = host(on, t.jsonl())
  world.messages = hostMessagesOf(t)
  await start($, world)
  const pane = await mountPane($)
  await drawHint($)
  await world.clock.settle()
  const reads = world.reads.length

  world.messages = rewoundTo(world.messages, 'CT-SYN three')
  await drawHint($)
  await world.clock.settle()

  const listed = await entryTexts(pane)
  expect(listed).toEqual(expect.arrayContaining(['CT-SYN one', 'CT-SYN two']))
  expect(listed).not.toContain('CT-SYN three')
  expect(listed).not.toContain('CT-SYN four')
  expect(world.messageCalls).toBe(1)
  expect(world.reads.length).toBe(reads)
})

test('once the file grows it decides again: the new branch, not the rewound turns', async ($, on) => {
  const { t, replies } = session(PROMPTS)
  const world = host(on, t.jsonl())
  world.messages = hostMessagesOf(t)
  await start($, world)
  const pane = await mountPane($)
  await drawHint($)
  await world.clock.settle()
  world.messages = rewoundTo(world.messages, 'CT-SYN three')
  await drawHint($)
  await world.clock.settle()

  t.rewindTo(replies[1]!)
  const uuid = t.prompt('CT-SYN new branch')
  world.file = t.jsonl()
  await appendRow($, uuid)
  await world.clock.advance(300)

  const listed = await entryTexts(pane)
  expect(listed).toEqual(expect.arrayContaining(['CT-SYN one', 'CT-SYN two', 'CT-SYN new branch']))
  expect(listed).not.toContain('CT-SYN three')
})

test('a turn under way, its count up, keeps the newest group', async ($, on) => {
  const { t } = session(PROMPTS)
  const world = host(on, t.jsonl())
  world.messages = hostMessagesOf(t)
  await start($, world)
  const pane = await mountPane($)
  await drawHint($)
  await world.clock.settle()

  const uuid = t.prompt('CT-SYN five')
  world.file = t.jsonl()
  world.messages = hostMessagesOf(t)
  await $.turn.start({ turnId: 'turn-5' } as never)
  await appendRow($, uuid)
  await drawHint($)
  await world.clock.advance(300)

  expect(await entryTexts(pane)).toEqual(expect.arrayContaining(['CT-SYN four', 'CT-SYN five']))
  expect(world.messageCalls).toBe(0)
})

test('messages that do not line up with the file hide nothing', async ($, on) => {
  const { t } = session(PROMPTS)
  const world = host(on, t.jsonl())
  world.messages = hostMessagesOf(t)
  await start($, world)
  const pane = await mountPane($)
  await drawHint($)
  await world.clock.settle()

  /* A compaction the file does not hold yet. */
  world.messages = [{ role: 'user', text: 'This session is being continued from a previous conversation. Summary: new.' }]
  await drawHint($)
  await world.clock.settle()

  expect(await entryTexts(pane)).toEqual(expect.arrayContaining(PROMPTS))
})
