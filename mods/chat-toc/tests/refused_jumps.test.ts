import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { drawnButtons, host, mountPane, start } from './host'
import { transcript } from './fixture'

/* CT-JUMP-003: when the host refuses every row a side tries, the pane says
   so at the bottom for a while and draws that side dim, with nothing else
   changed, until the host draws one of its rows again.

   The test engine refuses every transcript scroll a plugin asks for (it has
   no transcript), which stands for the host refusing them; a jump that lands
   is checked in the terminal. */

const REFUSED = '这一条当前没有显示在对话里，无法跳转'

async function session($: Engine, on: Parameters<typeof host>[0]) {
  const t = transcript()
  /* Long enough to fold: a refused side is dim on every line. */
  const asked = t.prompt('CT-SYN compacted away, a prompt long enough to take two lines')
  t.reply([{ type: 'text', text: 'CT-SYN answer' }])
  t.prompt('CT-SYN later')
  const world = host(on, t.jsonl())
  /* What Claude Code draws at a transcript site, beneath chat-toc's hooks. */
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
  await start($, world)
  const pane = await mountPane($)
  return { world, pane, asked }
}

const dimOf = async (pane: Awaited<ReturnType<typeof mountPane>>) =>
  Object.fromEntries(drawnButtons(await pane.drawn()).map(b => [b.key, b.dimColor]))

const saysRefused = async (pane: Awaited<ReturnType<typeof mountPane>>) =>
  (await pane.find({ type: 'Text', text: new RegExp(REFUSED) })) !== undefined

test('nothing is dimmed before a jump is refused', async ($, on) => {
  const { pane } = await session($, on)

  expect(await dimOf(pane)).toMatchObject({ 'g0.u': false, 'g0.u.1': false, 'g1.u': false })
  expect(await saysRefused(pane)).toBe(false)
})

test('a refused side is said at the bottom and drawn dim, every line, the rest as it was', async ($, on) => {
  const { pane } = await session($, on)

  await pane.press({ key: 'g0.u.1' })

  expect(await saysRefused(pane)).toBe(true)
  expect(await dimOf(pane)).toMatchObject({ 'g0.u': true, 'g0.u.1': true, 'g1.u': false })
})

test('the refusal goes after about five seconds; the side stays dim', async ($, on) => {
  const { pane, world } = await session($, on)
  await pane.press({ key: 'g0.u' })

  await world.clock.advance(4999)
  expect(await saysRefused(pane)).toBe(true)
  await world.clock.advance(1)
  expect(await saysRefused(pane)).toBe(false)
  expect((await dimOf(pane))['g0.u.1']).toBe(true)
})

test('the next jump takes the refusal away', async ($, on) => {
  const { pane } = await session($, on)
  await pane.press({ key: 'g0.u' })

  await pane.press({ key: 'g1.u' })

  /* That jump was refused too: the bottom now speaks of it. */
  expect(await saysRefused(pane)).toBe(true)
  expect(await dimOf(pane)).toMatchObject({ 'g0.u.1': true, 'g1.u': true })
})

test('moving the selection to another entry takes the refusal away', async ($, on) => {
  const { pane, world } = await session($, on)
  await pane.press({ key: 'g0.u' })

  await $.ui.focus({ component: 'Pane', requestId: 'chat-toc', element: 'g0.u.1', origin: { kind: 'person' } } as never)
  await world.clock.settle()
  expect(await saysRefused(pane)).toBe(true)

  await $.ui.focus({ component: 'Pane', requestId: 'chat-toc', element: 'g0.a', origin: { kind: 'person' } } as never)
  await world.clock.settle()
  expect(await saysRefused(pane)).toBe(false)
})

test('a refused row the transcript draws again brings its side back', async ($, on) => {
  const { pane, world, asked } = await session($, on)
  await pane.press({ key: 'g0.u' })

  await $.ui.mount({
    plugin: 'chat-toc',
    surface: 'terminal',
    component: 'UserMessage',
    requestId: asked,
    viewport: { columns: 160, rows: 40, isFullscreen: true },
    props: { text: 'CT-SYN compacted away', origin: { kind: 'composer' }, isExpanded: false, onScreen: { first: 0, last: 2, of: 3 } },
  } as never)
  await world.clock.settle()

  expect((await dimOf(pane))['g0.u.1']).toBe(false)
})
