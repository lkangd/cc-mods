import { expect, test } from 'claude-code/testing'

import type { Engine } from 'claude-code/testing'
import { PANE, TRANSCRIPT, drawnButtons, entryTexts, host, isEntryKey, mountPane, start } from './host'
import type { Host } from './host'
import { transcript } from './fixture'
import type { Builder } from './fixture'

/* CT-UI-001, CT-UI-002: the filter row's View filter and Layout Buttons,
   their hotkeys, and the two choices remembered across sessions. */

function three(): Builder {
  const t = transcript(new Date(2026, 9, 10, 9, 4).getTime())
  t.prompt('CT-SYN first')
  t.reply([{ type: 'text', text: 'CT-SYN first answer' }])
  t.localCommand('tui', '')
  t.prompt('CT-SYN third')
  t.reply([{ type: 'text', text: 'CT-SYN third answer' }])
  return t
}

type Pane = Awaited<ReturnType<typeof mountPane>>

async function controls(pane: Pane) {
  return drawnButtons(await pane.drawn())
    .filter(b => !isEntryKey(b.key))
    .map(b => ({ key: b.key, label: b.label }))
}

async function hotkeys(pane: Pane) {
  return (await pane.findAll({ type: 'Button' })).filter(b => !isEntryKey(b.key)).map(b => [b.key, b.props.hotkey, b.props.plain])
}

/* The store as the host keeps it for the plugin, seeded with `stored`. */
async function session($: Engine, on: Parameters<typeof host>[0], stored: Record<string, unknown> = {}): Promise<Host> {
  const world = host(on, three().jsonl(), TRANSCRIPT, stored)
  await start($, world)
  return world
}

test('the filter row shows all three filters, all chosen, and the Layout in use', async ($, on) => {
  const world = await session($, on)
  const pane = await mountPane($)

  expect(await controls(pane)).toEqual([
    { key: 'f-all', label: '●全部' },
    { key: 'f-user', label: '○用户' },
    { key: 'f-agent', label: '○Agent' },
    { key: 'layout', label: '布局:卡片' },
  ])
  expect(await hotkeys(pane)).toEqual([
    ['f-all', '1', true],
    ['f-user', '2', true],
    ['f-agent', '3', true],
    ['layout', 'l', true],
  ])
})

test('choosing a filter redraws at once with only those sides, and is remembered', async ($, on) => {
  const world = await session($, on)
  const pane = await mountPane($)

  await pane.press({ key: 'f-user' })
  expect((await controls(pane)).map(c => c.label).slice(0, 3)).toEqual(['○全部', '●用户', '○Agent'])
  expect(await entryTexts(pane)).toEqual(['你 · 10月10日 09:05', 'CT-SYN first', '你 · 10月10日 09:07', '/tui', '你 · 10月10日 09:08', 'CT-SYN third'])
  expect(world.store.viewFilter).toBe('user')

  /* The Agent filter hides the local command's group, which has no Agent side. */
  await pane.press({ key: 'f-agent' })
  expect(await entryTexts(pane)).toEqual(['↳', '  CT-SYN first answer', '↳', '  CT-SYN third answer'])
  expect(world.store.viewFilter).toBe('agent')
})

test('the Layout Button goes from cards to compact to timeline and back, each remembered', async ($, on) => {
  const world = await session($, on)
  const pane = await mountPane($)
  const layoutLabel = async () => (await controls(pane)).find(c => c.key === 'layout')?.label

  await pane.press({ key: 'layout' })
  expect(await layoutLabel()).toBe('布局:紧凑')
  expect(world.store.layout).toBe('compact')
  expect((await entryTexts(pane))[0]).toBe('CT-SYN first'.padEnd(37) + '09:05')

  await pane.press({ key: 'layout' })
  expect(await layoutLabel()).toBe('布局:时间轴')
  expect(world.store.layout).toBe('timeline')
  expect(await entryTexts(pane)).toEqual(['CT-SYN first', '↳ CT-SYN first answer', '/tui', 'CT-SYN third', '↳ CT-SYN third answer'])

  await pane.press({ key: 'layout' })
  expect(await layoutLabel()).toBe('布局:卡片')
  expect(world.store.layout).toBe('card')
})

test('a new session draws with the filter and Layout chosen in an earlier one', async ($, on) => {
  await session($, on, { viewFilter: 'agent', layout: 'timeline' })
  const pane = await mountPane($)

  expect((await controls(pane)).map(c => c.label)).toEqual(['○全部', '○用户', '●Agent', '布局:时间轴'])
  expect(await entryTexts(pane)).toEqual(['↳ CT-SYN first answer', '↳ CT-SYN third answer'])
})

test('stored values chat-toc does not know draw all sides as cards', async ($, on) => {
  await session($, on, { viewFilter: 'everything', layout: 7 })
  const pane = await mountPane($)

  expect((await controls(pane)).map(c => c.label)).toEqual(['●全部', '○用户', '○Agent', '布局:卡片'])
})

test('a store that refuses the choice still switches, this time', async ($, on) => {
  const world = await session($, on)
  world.refuseStore = true
  const pane = await mountPane($)

  await pane.press({ key: 'layout' })
  await pane.press({ key: 'f-agent' })

  expect((await controls(pane)).map(c => c.label)).toEqual(['○全部', '○用户', '●Agent', '布局:紧凑'])
  expect(world.store.layout).toBeUndefined()
})

test('the timeline draws its times and rail in a Text beside the Buttons, the card a blank gutter', async ($, on) => {
  await session($, on, { layout: 'timeline' })
  const pane = await mountPane($)

  const gutters = (await pane.findAll({ type: 'Text' })).map(t => t.text).filter(s => s.includes('│'))
  expect(gutters).toEqual(['09:05 │ ', '      │ ', '09:07 │ ', '09:08 │ ', '      │ '])
})

test('where the Layout Button does not fit beside the filter it goes on a row of its own', async ($, on) => {
  const world = await session($, on)
  const narrow = await $.ui.mount({
    plugin: 'chat-toc',
    surface: 'terminal',
    component: 'Pane',
    requestId: PANE,
    viewport: { columns: 160, rows: 40, isFullscreen: true },
    props: { title: '目录', isFocused: false, bodyColumns: 34, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  })
  const tree = (await narrow.drawn()) as { children: { props: Record<string, unknown> }[] }

  expect(tree.children[0]?.props.flexDirection).toBe('column')
  expect((await controls(narrow)).map(c => c.key)).toEqual(['f-all', 'f-user', 'f-agent', 'layout'])
})
