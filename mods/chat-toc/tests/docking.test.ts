import { expect, test } from 'claude-code/testing'
import { DOCK_STATUS, placementFate } from '../hooks/lifecycle'
import { PANE, drawHint, host, mountPane, start } from './host'

/* Where the pane may be (spec §2, ticket 26): it opens by itself only in
   the fullscreen layout and only docked; while it cannot dock the status
   line says why and how to get it; /chat-toc takes whatever the host gives. */

const OPEN = { id: PANE, title: '目录', columns: 44 }
const SESSION = { cwd: '/home/synthetic/project', surface: 'terminal', isInteractive: true } as const

const last = (statuses: readonly (string | undefined)[]) => statuses[statuses.length - 1]

test('the status line says what to do, in the words the person reads', () => {
  expect(DOCK_STATUS).toEqual({
    mainScreen: '目录只在全屏布局里停靠在右侧，运行 /tui fullscreen 切换',
    narrow: '终端太窄，目录没有停靠；把终端拉宽后会自动出现',
    askedNarrow: '终端太窄，目录暂时放在输入框上方；把终端拉宽后会停靠到右侧',
    askedMainScreen: '非全屏布局里目录放在输入框上方；运行 /tui fullscreen 切换后会停靠到右侧',
  })
})

test('a drawing docked settles it; inline is kept only for the one /chat-toc asked for', () => {
  expect(placementFate('dock', false)).toBe('docked')
  expect(placementFate('dock', true)).toBe('docked')
  expect(placementFate('inline', true)).toBe('asked-inline')
  expect(placementFate('inline', false)).toBe('withdraw')
})

test('outside the fullscreen layout nothing opens by itself, and the status line says how to get the dock', async ($, on) => {
  const world = host(on)
  await start($, world, false)

  expect(world.opens).toEqual([])
  expect(last(world.statuses)).toBe(DOCK_STATUS.mainScreen)
})

test('the open waits for the terminal to say its layout', async ($, on) => {
  const world = host(on)
  await $.session.start(SESSION)
  await world.clock.settle()
  expect(world.opens).toEqual([])

  await drawHint($)
  await world.clock.settle()

  expect(world.opens).toEqual([OPEN])
})

test('an unasked open on a narrow terminal waits undrawn with the reason on the status line, cleared once it docks', async ($, on) => {
  const world = host(on)
  world.unplaced = true
  await start($, world)

  expect(world.opens).toEqual([OPEN])
  expect(world.closes).toEqual([])
  expect(last(world.statuses)).toBe(DOCK_STATUS.narrow)

  /* The terminal widens: the host seats the waiting pane and draws it. */
  world.unplaced = false
  world.panes = world.panes.map(p => ({ ...p, isPlaced: true }))
  await mountPane($)
  await world.clock.settle()

  expect(last(world.statuses)).toBe(undefined)
  expect(world.opens).toEqual([OPEN])
})

test('a session start finding the pane still waiting opens no second one and keeps the reason up', async ($, on) => {
  const world = host(on)
  world.unplaced = true
  await start($, world)

  await $.session.start(SESSION)
  await world.clock.settle()

  expect(world.opens).toEqual([OPEN])
  expect(last(world.statuses)).toBe(DOCK_STATUS.narrow)
})

test('a docked pane the host turns inline is closed by chat-toc, which opens it again to wait for the room', async ($, on) => {
  const world = host(on)
  await start($, world)
  const pane = await mountPane($)
  await world.clock.settle()
  world.opens.length = 0

  /* The terminal narrows below what docks: the host draws the pane inline. */
  world.unplaced = true
  await pane.redraw({ title: '目录', isFocused: false, bodyColumns: 96, placement: 'inline', scroll: { offset: 0, bodyRows: 12 }, view: {} })
  await world.clock.settle()

  expect(world.closes).toEqual([{ id: PANE, origin: 'plugin' }])
  expect(world.opens).toEqual([OPEN])
  expect(world.panes.map(p => p.isPlaced)).toEqual([false])
  expect(last(world.statuses)).toBe(DOCK_STATUS.narrow)
})

test('/chat-toc on the main screen is placed inline and kept, the status line saying how to get the dock', async ($, on) => {
  const world = host(on)
  await start($, world, false)

  await $.command.run({ command: 'chat-toc', args: '' } as never)
  await mountPane($, 12, 'inline', false)
  await world.clock.settle()

  expect(world.opens).toEqual([{ ...OPEN, focus: true }])
  expect(world.closes).toEqual([])
  expect(last(world.statuses)).toBe(DOCK_STATUS.askedMainScreen)
})

test('/chat-toc on a narrow fullscreen terminal is kept inline; once the host docks it, a later inline is withdrawn', async ($, on) => {
  const world = host(on)
  world.unplaced = true
  await start($, world)
  world.unplaced = false

  await $.command.run({ command: 'chat-toc', args: '' } as never)
  const pane = await mountPane($, 12, 'inline')
  await world.clock.settle()

  expect(world.closes).toEqual([])
  expect(last(world.statuses)).toBe(DOCK_STATUS.askedNarrow)

  const docked = { title: '目录', isFocused: false, bodyColumns: 44, scroll: { offset: 0, bodyRows: 30 }, view: {} }
  await pane.redraw({ ...docked, placement: 'dock' })
  await world.clock.settle()
  expect(last(world.statuses)).toBe(undefined)

  world.unplaced = true
  await pane.redraw({ ...docked, placement: 'inline' })
  await world.clock.settle()
  expect(world.closes).toEqual([{ id: PANE, origin: 'plugin' }])
  expect(last(world.statuses)).toBe(DOCK_STATUS.narrow)
})

test('a pane withdrawn and seated inline again at once is not reopened over and over', async ($, on) => {
  const world = host(on)
  await start($, world)
  const pane = await mountPane($)
  await world.clock.settle()

  const inline = { title: '目录', isFocused: false, bodyColumns: 96, placement: 'inline' as const, scroll: { offset: 0, bodyRows: 12 }, view: {} }
  await pane.redraw(inline)
  await world.clock.settle()
  await pane.redraw({ ...inline, bodyColumns: 95 })
  await world.clock.settle()

  expect(world.closes.length).toBe(2)
  expect(world.opens.length).toBe(2)
  expect(last(world.statuses)).toBe(DOCK_STATUS.narrow)
})
