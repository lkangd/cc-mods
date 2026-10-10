import { expect, test } from 'claude-code/testing'
import { cardEntries } from '../hooks/entries'
import { jumpTargetOf } from '../hooks/jump'
import { tocModel } from '../hooks/model'
import { NOW, PANE, TRANSCRIPT, appendRow, drawnButtons, host, mountPane, start } from './host'
import { transcript } from './fixture'

/* The tracer: a fullscreen session opens the docked Chat TOC, which lists
   the session's prompts from its transcript and jumps back to one. */

test('a session start opens the docked pane, 44 columns wide', async ($, on) => {
  const world = host(on)
  await start($, world)

  expect(world.opens).toEqual([{ id: PANE, title: '目录', columns: 44 }])
})

test('a pane already open, as after a hot reload, is not opened again', async ($, on) => {
  const world = host(on)
  world.panes = [{ id: PANE, title: '目录', isShown: true, isFocused: false, isPlaced: true }]
  await start($, world)

  expect(world.opens).toEqual([])
})

test('the /chat-toc command is registered and opens the pane', async ($, on) => {
  const world = host(on)
  await start($, world)
  world.opens.length = 0

  const ran = await $.command.run({ command: 'chat-toc', args: '' } as never)

  expect(world.opens).toEqual([{ id: PANE, title: '目录', columns: 44 }])
  expect(ran).toBeDefined()
})

test('the pane lists each prompt as a dim header and its first lines', async ($, on) => {
  const t = transcript(new Date(2026, 9, 10, 9, 4).getTime())
  t.prompt('CT-SYN first prompt')
  t.reply([{ type: 'text', text: 'answer' }])
  t.prompt('CT-SYN second prompt')
  const world = host(on, t.jsonl())
  await start($, world)

  const pane = await mountPane($)

  expect(drawnButtons(await pane.drawn())).toEqual([
    { key: 'g0.u', label: '你 · 10月10日 09:05', plain: true, dimColor: true, hover: { scope: 'e-g0.u', inverse: true } },
    { key: 'g0.u.1', label: 'CT-SYN first prompt', plain: true, dimColor: false, hover: { scope: 'e-g0.u', inverse: true } },
    { key: 'g1.u', label: '你 · 10月10日 09:07', plain: true, dimColor: true, hover: { scope: 'e-g1.u', inverse: true } },
    { key: 'g1.u.1', label: 'CT-SYN second prompt', plain: true, dimColor: false, hover: { scope: 'e-g1.u', inverse: true } },
  ])
})

test('every line of a prompt jumps to that prompt, its top at the top of the view', async ($, on) => {
  const t = transcript()
  t.prompt('CT-SYN first prompt')
  const second = t.prompt('CT-SYN second prompt')
  const world = host(on, t.jsonl())
  await start($, world)
  const pane = await mountPane($)

  /* The test engine does not hand a transcript scroll to the test's hooks;
     where it lands is checked in the terminal. Here: each line presses, and
     the entry's target is the prompt's own row. */
  await pane.press({ key: 'g1.u' })
  await pane.press({ key: 'g1.u.1' })
  const entries = cardEntries(tocModel(t.jsonl()).groups, 44, NOW)
  expect(entries[1] && jumpTargetOf(entries[1])).toEqual({ requestId: second, block: 'start' })
})

test('before the first message the file does not exist and the pane says so', async ($, on) => {
  const world = host(on)
  await start($, world)
  const pane = await mountPane($)

  expect(await pane.findAll({ type: 'Button' })).toEqual([])
  expect((await pane.find({ type: 'Text', text: '本会话还没有对话' }))?.text).toBe('本会话还没有对话')
})

test('the first prompt written to the file appears once its row is appended', async ($, on) => {
  const world = host(on)
  await start($, world)
  const pane = await mountPane($)

  const t = transcript()
  const first = t.prompt('CT-SYN arrives')
  world.file = t.jsonl()
  await appendRow($, first)
  await world.clock.advance(300)

  expect((await pane.findAll({ type: 'Button' })).map(b => b.text)).toContain('CT-SYN arrives')
  expect(await pane.find({ text: '本会话还没有对话' })).toBeUndefined()
})

test('appends are read together 300 ms after the first, and not before', async ($, on) => {
  const t = transcript()
  t.prompt('CT-SYN one')
  const world = host(on, t.jsonl())
  await start($, world)
  world.reads.length = 0

  t.prompt('CT-SYN two')
  world.file = t.jsonl()
  await appendRow($, 'a')
  await world.clock.advance(100)
  await appendRow($, 'b')
  await world.clock.advance(199)
  expect(world.reads).toEqual([])

  await world.clock.advance(1)
  expect(world.reads).toEqual([TRANSCRIPT])
  await world.clock.advance(1000)
  expect(world.reads).toEqual([TRANSCRIPT])
})

test("a subagent's rows do not make the pane read", async ($, on) => {
  const t = transcript()
  t.prompt('CT-SYN one')
  const world = host(on, t.jsonl())
  await start($, world)
  world.reads.length = 0

  world.file = t.jsonl() + '\n'
  await appendRow($, 'sub', 'agent-1')
  await world.clock.advance(1000)

  expect(world.reads).toEqual([])
})

test('a file the same size as last read is not read again', async ($, on) => {
  const t = transcript()
  t.prompt('CT-SYN one')
  const world = host(on, t.jsonl())
  await start($, world)
  world.reads.length = 0

  await appendRow($, 'same-size')
  await world.clock.advance(300)

  expect(world.reads).toEqual([])
})

test('a finished turn reads at 300 ms and looks again 1.5 s later for rows written late', async ($, on) => {
  const t = transcript()
  t.prompt('CT-SYN one')
  const world = host(on, t.jsonl())
  await start($, world)
  world.reads.length = 0

  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await world.clock.advance(300)
  expect(world.reads).toEqual([])

  t.prompt('CT-SYN late row')
  world.file = t.jsonl()
  await world.clock.advance(1200)
  expect(world.reads).toEqual([TRANSCRIPT])
  const pane = await mountPane($)
  expect((await pane.findAll({ type: 'Button' })).map(b => b.text)).toContain('CT-SYN late row')
})

test('a read that lands while another runs is not lost', async ($, on) => {
  const t = transcript()
  t.prompt('CT-SYN one')
  const world = host(on, t.jsonl())
  await start($, world)
  let release: () => void = () => {}
  world.hold = new Promise<void>(resolve => {
    release = resolve
  })

  t.prompt('CT-SYN two')
  world.file = t.jsonl()
  await appendRow($, 'a')
  await world.clock.advance(300)
  world.hold = undefined
  t.prompt('CT-SYN three')
  world.file = t.jsonl()
  await appendRow($, 'b')
  await world.clock.advance(300)
  release()
  await world.clock.settle()

  const pane = await mountPane($)
  expect((await pane.findAll({ type: 'Button' })).map(b => b.text)).toContain('CT-SYN three')
})
