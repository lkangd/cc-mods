import { expect, test } from 'claude-code/testing'
import { isClosedByPerson, reopensOn } from '../hooks/lifecycle'
import { PANE, TRANSCRIPT, appendRow, drawHint, entryTexts, host, mountPane, readsOf, start } from './host'
import { transcript } from './fixture'

/* The pane's lifecycle (spec §2): it opens on its own when a session starts,
   stays closed once the person closes it, comes back with /chat-toc, and
   opens again for the new session after /clear and /resume. */

const OPEN = { id: PANE, title: '目录', columns: 44 }
const SESSION = { cwd: '/home/synthetic/project', surface: 'terminal', isInteractive: true } as const
const OTHER_TRANSCRIPT = '/home/synthetic/.claude/projects/p/synthetic-next.jsonl'

/* The test engine cannot raise `ui.close` (the host's ✕ is not the
   plugin's to press), so which close marks the pane closed is checked at
   the seam, and the mark itself in the terminal (CT-LIFE-001). */

test("only the person closing chat-toc's own pane keeps it closed", () => {
  expect(isClosedByPerson({ id: PANE, origin: { kind: 'person' } })).toBe(true)
  expect(isClosedByPerson({ id: PANE, origin: { kind: 'plugin' } })).toBe(false)
  expect(isClosedByPerson({ id: PANE, origin: { kind: 'unload' } })).toBe(false)
  expect(isClosedByPerson({ id: 'diff', origin: { kind: 'person' } })).toBe(false)
})

test('the pane opens again for a session started by /clear or /resume, not for a compaction or a fork', () => {
  expect(reopensOn('clear')).toBe(true)
  expect(reopensOn('resume')).toBe(true)
  expect(reopensOn('startup')).toBe(false)
  expect(reopensOn('compact')).toBe(false)
  expect(reopensOn('fork')).toBe(false)
})

test('a session start with the pane gone, closed but not by the person, opens it again', async ($, on) => {
  const world = host(on)
  await start($, world)
  world.panes = []
  world.opens.length = 0

  await $.session.start(SESSION)
  await world.clock.settle()

  expect(world.opens).toEqual([OPEN])
})

test('/chat-toc opens the pane when it is not open', async ($, on) => {
  const world = host(on)
  await start($, world)
  world.panes = []
  world.opens.length = 0

  await $.command.run({ command: 'chat-toc', args: '' } as never)

  expect(world.opens).toEqual([OPEN])
  expect(world.panes.map(p => p.id)).toEqual([PANE])
})

test('/chat-toc on an open pane, shown or behind another tab, raises it and asks for the keyboard', async ($, on) => {
  const world = host(on)
  await start($, world)
  world.panes = [{ id: PANE, title: '目录', isShown: false, isFocused: false, isPlaced: true }]
  world.opens.length = 0

  await $.command.run({ command: 'chat-toc', args: '' } as never)

  expect(world.opens).toEqual([{ ...OPEN, focus: true }])
  expect(world.closes).toEqual([])
})

test('/chat-toc never closes the pane, however often it runs', async ($, on) => {
  const world = host(on)
  await start($, world)

  await $.command.run({ command: 'chat-toc', args: '' } as never)
  await $.command.run({ command: 'chat-toc', args: '' } as never)

  expect(world.closes).toEqual([])
  expect(world.panes.map(p => p.id)).toEqual([PANE])
})

test('/clear opens the pane again for the new session when it is not open', async ($, on) => {
  const world = host(on)
  await start($, world)
  world.panes = []
  world.opens.length = 0

  await $.classic.SessionStart({ source: 'clear', transcript_path: OTHER_TRANSCRIPT })
  await world.clock.settle()

  expect(world.opens).toEqual([OPEN])
})

test('/resume opens the pane again for the resumed session when it is not open', async ($, on) => {
  const world = host(on)
  await start($, world)
  world.panes = []
  world.opens.length = 0

  await $.classic.SessionStart({ source: 'resume', transcript_path: OTHER_TRANSCRIPT })
  await world.clock.settle()

  expect(world.opens).toEqual([OPEN])
})

test('a session start for a compaction does not open the pane', async ($, on) => {
  const world = host(on)
  await start($, world)
  world.panes = []
  world.opens.length = 0

  await $.classic.SessionStart({ source: 'compact', transcript_path: TRANSCRIPT })
  await world.clock.settle()

  expect(world.opens).toEqual([])
})

test('/clear with the pane still open does not open a second one', async ($, on) => {
  const world = host(on)
  await start($, world)
  world.opens.length = 0

  await $.classic.SessionStart({ source: 'clear', transcript_path: OTHER_TRANSCRIPT })
  await world.clock.settle()

  expect(world.opens).toEqual([])
})

test('a process resumed at start opens the pane once, from whichever start event comes first', async ($, on) => {
  const world = host(on)
  await Promise.all([
    $.classic.SessionStart({ source: 'resume', transcript_path: TRANSCRIPT }),
    $.session.start(SESSION),
  ])
  await drawHint($)
  await world.clock.settle()

  expect(world.opens).toEqual([OPEN])
})

test('/clear lists the new, empty session in place of the old one, with nothing parting them', async ($, on) => {
  const t = transcript()
  t.prompt('CT-SYN before clear')
  const world = host(on, t.jsonl())
  await start($, world)
  const pane = await mountPane($)
  expect((await pane.findAll({ type: 'Button' })).map(b => b.text)).toContain('CT-SYN before clear')

  world.path = OTHER_TRANSCRIPT
  world.file = undefined
  await $.classic.SessionStart({ source: 'clear', transcript_path: OTHER_TRANSCRIPT })
  await world.clock.settle()

  expect(await entryTexts(pane)).toEqual([])
  expect((await pane.find({ type: 'Text', text: '本会话还没有对话' }))?.text).toBe('本会话还没有对话')

  const next = transcript()
  next.prompt('CT-SYN after clear')
  world.file = next.jsonl()
  await $.classic.SessionStart({ source: 'clear', transcript_path: OTHER_TRANSCRIPT })
  await world.clock.settle()
  expect((await pane.findAll({ type: 'Button' })).map(b => b.text).filter(s => s.startsWith('CT-SYN'))).toEqual(['CT-SYN after clear'])
})

test('/resume reads the resumed session from its own file', async ($, on) => {
  const t = transcript()
  t.prompt('CT-SYN first session')
  const world = host(on, t.jsonl())
  await start($, world)
  const pane = await mountPane($)

  const other = transcript()
  other.prompt('CT-SYN resumed session')
  world.path = OTHER_TRANSCRIPT
  world.file = other.jsonl()
  const before = readsOf(world)
  await $.classic.SessionStart({ source: 'resume', transcript_path: OTHER_TRANSCRIPT })
  await world.clock.settle()

  expect(readsOf(world)).toBeGreaterThan(before)
  const texts = (await pane.findAll({ type: 'Button' })).map(b => b.text).filter(s => s.startsWith('CT-SYN'))
  expect(texts).toEqual(['CT-SYN resumed session'])
})

/* A resumed or forked session can show its history in the transcript while
   its own file is not written yet (the host writes a fork's file at the
   first submit): the pane says so, not that there is no conversation. */

const NOT_WRITTEN = '本会话还没写进 transcript 文件，提交第一条消息后显示目录'

for (const source of ['resume', 'fork'] as const) {
  test(`a session started by ${source} whose file is not written yet says the list shows after the first submit`, async ($, on) => {
    const world = host(on, undefined, OTHER_TRANSCRIPT)
    await $.classic.SessionStart({ source, transcript_path: OTHER_TRANSCRIPT })
    await world.clock.settle()
    const pane = await mountPane($)

    expect((await pane.find({ type: 'Text', text: NOT_WRITTEN }))?.text).toBe(NOT_WRITTEN)
    expect(await pane.find({ type: 'Text', text: '本会话还没有对话' })).toBeUndefined()
  })
}

test('a session started or cleared with no file yet still says it has no conversation', async ($, on) => {
  const world = host(on, undefined, OTHER_TRANSCRIPT)
  await $.classic.SessionStart({ source: 'clear', transcript_path: OTHER_TRANSCRIPT })
  await world.clock.settle()
  const pane = await mountPane($)

  expect((await pane.find({ type: 'Text', text: '本会话还没有对话' }))?.text).toBe('本会话还没有对话')
  expect(await pane.find({ type: 'Text', text: NOT_WRITTEN })).toBeUndefined()
})

test('a compaction in a resumed session that is written already does not change what an empty file says later', async ($, on) => {
  const world = host(on, undefined, OTHER_TRANSCRIPT)
  await $.classic.SessionStart({ source: 'startup', transcript_path: OTHER_TRANSCRIPT })
  await $.classic.SessionStart({ source: 'compact', transcript_path: OTHER_TRANSCRIPT })
  await world.clock.settle()
  const pane = await mountPane($)

  expect((await pane.find({ type: 'Text', text: '本会话还没有对话' }))?.text).toBe('本会话还没有对话')
})

test("once a resumed session's file is written its turns are listed", async ($, on) => {
  const world = host(on, undefined, OTHER_TRANSCRIPT)
  await $.classic.SessionStart({ source: 'resume', transcript_path: OTHER_TRANSCRIPT })
  await world.clock.settle()
  const pane = await mountPane($)

  const t = transcript()
  const first = t.prompt('CT-SYN first submit after fork')
  world.file = t.jsonl()
  await appendRow($, first)
  await world.clock.advance(300)

  expect((await pane.findAll({ type: 'Button' })).map(b => b.text)).toContain('CT-SYN first submit after fork')
  expect(await pane.find({ type: 'Text', text: NOT_WRITTEN })).toBeUndefined()
})
