import { expect, test } from 'claude-code/testing'
import { PANE, host, mountPane, start } from './host'

/* Where the pane may be: it opens by itself at every start, whatever the
   layout or width, and stays however the host places it, docked, inline or
   waiting undrawn; chat-toc neither closes it nor explains on the status
   line. */

const OPEN = { id: PANE, title: 'ChatTOC', columns: 44 }
const SESSION = { cwd: '/home/synthetic/project', surface: 'terminal', isInteractive: true } as const

test('the pane opens at the start without waiting for the terminal to say its layout', async ($, on) => {
  const world = host(on)
  await $.session.start(SESSION)
  await world.clock.settle()

  expect(world.opens).toEqual([OPEN])
  expect(world.statuses).toEqual([])
})

test('outside the fullscreen layout the pane opens by itself as well', async ($, on) => {
  const world = host(on)
  await start($, world, false)

  expect(world.opens).toEqual([OPEN])
  expect(world.statuses).toEqual([])
})

test('a pane the host keeps waiting is opened once, and a later start opens no second one', async ($, on) => {
  const world = host(on)
  world.unplaced = true
  await start($, world)

  await $.session.start(SESSION)
  await world.clock.settle()

  expect(world.opens).toEqual([OPEN])
  expect(world.closes).toEqual([])
  expect(world.statuses).toEqual([])
})

test('a docked pane the host turns inline is kept as it is', async ($, on) => {
  const world = host(on)
  await start($, world)
  const pane = await mountPane($)
  await world.clock.settle()

  await pane.redraw({ title: 'ChatTOC', isFocused: false, bodyColumns: 96, placement: 'inline', scroll: { offset: 0, bodyRows: 12 }, view: {} })
  await world.clock.settle()

  expect(world.closes).toEqual([])
  expect(world.opens).toEqual([OPEN])
  expect(world.statuses).toEqual([])
})

test('/chat-toc placed inline is kept, with nothing on the status line', async ($, on) => {
  const world = host(on)
  await start($, world, false)

  await $.command.run({ command: 'chat-toc', args: '' } as never)
  await mountPane($, 12, 'inline', false)
  await world.clock.settle()

  expect(world.opens).toEqual([OPEN, { ...OPEN, focus: true }])
  expect(world.closes).toEqual([])
  expect(world.statuses).toEqual([])
})
