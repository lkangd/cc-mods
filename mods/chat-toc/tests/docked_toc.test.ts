import { expect, test } from 'claude-code/testing'
import { PANE, appendRow, drawnButtons, entryTexts, host, isEntryKey, mountPane, readsOf, start } from './host'
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
  world.panes = []
  world.opens.length = 0

  const ran = await $.command.run({ command: 'chat-toc', args: '' } as never)

  expect(world.opens).toEqual([{ id: PANE, title: '目录', columns: 44, focus: true }])
  expect(ran).toBeDefined()
})

test('the pane lists each side as plain Buttons, the Agent reply dim, a side lit together on hover', async ($, on) => {
  const t = transcript(new Date(2026, 9, 10, 9, 4).getTime())
  t.prompt('CT-SYN first prompt')
  t.reply([{ type: 'text', text: 'answer' }])
  t.prompt('CT-SYN second prompt')
  const world = host(on, t.jsonl())
  await start($, world)

  const pane = await mountPane($)

  expect(drawnButtons(await pane.drawn()).filter(b => isEntryKey(b.key))).toEqual([
    { key: 'g0.u', label: 'CT-SYN first prompt', plain: true, dimColor: false, hover: { scope: 'e-g0.u', color: 'suggestion' } },
    { key: 'g0.a', label: 'answer', plain: true, dimColor: true, hover: { scope: 'e-g0.a', color: 'suggestion' } },
    { key: 'g1.u', label: 'CT-SYN second prompt', plain: true, dimColor: false, hover: { scope: 'e-g1.u', color: 'suggestion' } },
  ])
})

test('a blank line parts one turn group from the next, not the two sides of one', async ($, on) => {
  const t = transcript()
  t.prompt('CT-SYN first prompt')
  t.reply([{ type: 'text', text: 'CT-SYN first answer' }])
  t.prompt('CT-SYN second prompt')
  t.reply([{ type: 'text', text: 'CT-SYN second answer' }])
  const world = host(on, t.jsonl())
  await start($, world)

  /* The head, a day's rule, two groups of two 1-line sides and one blank line between, the footer: 11 rows. */
  const pane = await mountPane($, 11)

  expect((await entryTexts(pane)).filter(s => s.includes('CT-SYN'))).toEqual([
    'CT-SYN first prompt',
    'CT-SYN first answer',
    'CT-SYN second prompt',
    'CT-SYN second answer',
  ])
})

/* CT-TURN-004: between the host's turn.start and turn.complete the last
   group is in progress, its steps growing as the file records them. */

test('a running turn shows in progress with its steps so far, and its count once it completes', async ($, on) => {
  const t = transcript()
  t.prompt('CT-SYN earlier')
  t.reply([{ type: 'text', text: 'CT-SYN earlier answer' }])
  const world = host(on, t.jsonl())
  await start($, world)
  const pane = await mountPane($)
  const heads = async () => drawnButtons(await pane.drawn()).filter(b => /^g\d+\.a$/.test(String(b.key))).map(b => b.label)

  await $.turn.start({ text: 'CT-SYN working', turnId: 'turn-1' })
  const asked = t.prompt('CT-SYN working')
  world.file = t.jsonl()
  await appendRow($, asked)
  await world.clock.advance(300)
  expect(await heads()).toEqual(['CT-SYN earlier answer', '进行中'])

  const call = t.reply([{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }])
  world.file = t.jsonl()
  await appendRow($, call)
  await world.clock.advance(300)
  expect(await heads()).toEqual(['CT-SYN earlier answer', '进行中 · 1 步'])

  t.toolResult('t1')
  const answer = t.reply([{ type: 'text', text: 'CT-SYN all done' }])
  world.file = t.jsonl()
  await appendRow($, answer)
  await $.turn.complete({ answer: 'CT-SYN all done', durationMs: 1, isAborted: false, turnId: 'turn-1', reason: 'answer' })
  /* Until the reply's row is read, the group does not claim it has none. */
  expect(await heads()).toEqual(['CT-SYN earlier answer', '进行中 · 1 步'])
  await world.clock.advance(300)
  expect(await heads()).toEqual(['CT-SYN earlier answer', '1 步 · CT-SYN all done'])
})

test('a turn that completes with every row already read stops showing in progress', async ($, on) => {
  const t = transcript()
  t.prompt('CT-SYN asked')
  t.reply([{ type: 'text', text: 'CT-SYN answered' }])
  const world = host(on, t.jsonl())
  await start($, world)
  const pane = await mountPane($)

  await $.turn.start({ text: '', turnId: 'turn-1' })
  await world.clock.advance(300)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'turn-1', reason: 'answer' })
  await world.clock.advance(300)

  expect((await entryTexts(pane))).toContain('CT-SYN answered')
  expect((await entryTexts(pane)).some(s => s.includes('进行中'))).toBe(false)
})

test("a subagent's turn does not end the main agent's", async ($, on) => {
  const t = transcript()
  t.prompt('CT-SYN delegate')
  t.reply([{ type: 'tool_use', id: 't1', name: 'Agent', input: {} }])
  const world = host(on, t.jsonl())
  await start($, world)
  await $.turn.start({ text: 'CT-SYN delegate', turnId: 'turn-1' })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'sub-1', reason: 'answer', agentId: 'agent-1' })
  await world.clock.advance(2000)

  const pane = await mountPane($)
  expect((await entryTexts(pane))).toContain('进行中 · 1 步')
})

test('before the first message the file does not exist and the pane says so', async ($, on) => {
  const world = host(on)
  await start($, world)
  const pane = await mountPane($)

  expect(await entryTexts(pane)).toEqual([])
  expect((await pane.find({ type: 'Text', text: '本会话还没有对话' }))?.text).toBe('本会话还没有对话')
})

test('the first User input written to the file appears once its row is appended', async ($, on) => {
  const world = host(on)
  await start($, world)
  const pane = await mountPane($)

  const t = transcript()
  const first = t.prompt('CT-SYN arrives')
  world.file = t.jsonl()
  await appendRow($, first)
  await world.clock.advance(300)

  expect((await entryTexts(pane))).toContain('CT-SYN arrives')
  expect(await pane.find({ text: '本会话还没有对话' })).toBeUndefined()
})

test('appends are read together 300 ms after the first, and not before', async ($, on) => {
  const t = transcript()
  t.prompt('CT-SYN one')
  const world = host(on, t.jsonl())
  await start($, world)
  world.reads.length = 0
  world.runs.length = 0

  t.prompt('CT-SYN two')
  world.file = t.jsonl()
  await appendRow($, 'a')
  await world.clock.advance(100)
  await appendRow($, 'b')
  await world.clock.advance(199)
  expect(readsOf(world)).toBe(0)

  await world.clock.advance(1)
  expect(readsOf(world)).toBe(1)
  await world.clock.advance(1000)
  expect(readsOf(world)).toBe(1)
})

test("a subagent's rows do not make the pane read", async ($, on) => {
  const t = transcript()
  t.prompt('CT-SYN one')
  const world = host(on, t.jsonl())
  await start($, world)
  world.reads.length = 0
  world.runs.length = 0

  world.file = t.jsonl() + '\n'
  await appendRow($, 'sub', 'agent-1')
  await world.clock.advance(1000)

  expect(readsOf(world)).toBe(0)
})

test('a file the same size as last read is not read again', async ($, on) => {
  const t = transcript()
  t.prompt('CT-SYN one')
  const world = host(on, t.jsonl())
  await start($, world)
  world.reads.length = 0
  world.runs.length = 0

  await appendRow($, 'same-size')
  await world.clock.advance(300)

  expect(readsOf(world)).toBe(0)
})

test('a finished turn reads at 300 ms and looks again 1.5 s later for rows written late', async ($, on) => {
  const t = transcript()
  t.prompt('CT-SYN one')
  const world = host(on, t.jsonl())
  await start($, world)
  world.reads.length = 0
  world.runs.length = 0

  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await world.clock.advance(300)
  expect(readsOf(world)).toBe(0)

  t.prompt('CT-SYN late row')
  world.file = t.jsonl()
  await world.clock.advance(1200)
  expect(readsOf(world)).toBe(1)
  const pane = await mountPane($)
  expect((await entryTexts(pane))).toContain('CT-SYN late row')
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
  expect((await entryTexts(pane))).toContain('CT-SYN three')
})
