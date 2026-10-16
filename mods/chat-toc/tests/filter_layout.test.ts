import { expect, test } from 'claude-code/testing'

import type { Engine } from 'claude-code/testing'
import { PANE, TRANSCRIPT, drawnButtons, entryTexts, host, isControlKey, mountPane, start } from './host'
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
    .filter(b => isControlKey(b.key))
    .map(b => ({ key: b.key, label: b.label }))
}

/* The filter Buttons' labels, the chosen one marked `*`: it is drawn at
   full strength, the others dim. */
async function filters(pane: Pane) {
  return drawnButtons(await pane.drawn())
    .filter(b => typeof b.key === 'string' && b.key.startsWith('f-'))
    .map(b => (b.dimColor ? String(b.label) : `*${String(b.label)}`))
}

/* The tab rule under the filter row, as runs of one colour, across the
   pane's 44 columns. */
async function tabRule(pane: Pane) {
  const runs: [string, unknown][] = []
  let cells = 0
  for (const t of await pane.findAll({ type: 'Text' })) {
    if (cells >= 44) break
    if (!/^[━─]+$/.test(t.text)) continue
    runs.push([t.text, t.props.color])
    cells += [...t.text].length
  }
  return runs
}

async function hotkeys(pane: Pane) {
  return (await pane.findAll({ type: 'Button' })).filter(b => isControlKey(b.key)).map(b => [b.key, b.props.hotkey, b.props.plain])
}

/* The store as the host keeps it for the plugin, seeded with `stored`. */
async function session($: Engine, on: Parameters<typeof host>[0], stored: Record<string, unknown> = {}): Promise<Host> {
  const world = host(on, three().jsonl(), TRANSCRIPT, stored)
  await start($, world)
  return world
}

test('the filter row shows the three filters by name, the chosen one at full strength, with their hotkeys', async ($, on) => {
  await session($, on)
  const pane = await mountPane($)

  expect(await filters(pane)).toEqual(['*全部', '用户', 'Agent'])
  expect(await hotkeys(pane)).toEqual([
    ['f-all', '1', true],
    ['f-user', '2', true],
    ['f-agent', '3', true],
    ['find', 'f', true],
    ['preview', 'p', true],
    ['layout', 'l', true],
  ])
})

/* The host draws a plain Button with a hotkey as `1: 全部`: 7 cells, and
   the filters stand 3 cells apart. */
test('a rule under the filter row marks the chosen filter, heavy and in the highlight colour', async ($, on) => {
  await session($, on)
  const pane = await mountPane($)
  const thin = (n: number): [string, unknown] => ['─'.repeat(n), 'subtle']
  const heavy = (n: number): [string, unknown] => ['━'.repeat(n), 'suggestion']

  expect(await tabRule(pane)).toEqual([heavy(7), thin(37)])
  await pane.press({ key: 'f-user' })
  expect(await tabRule(pane)).toEqual([thin(10), heavy(7), thin(27)])
  await pane.press({ key: 'f-agent' })
  expect(await tabRule(pane)).toEqual([thin(20), heavy(8), thin(16)])
})

test('choosing a filter redraws at once with only those sides, and is remembered', async ($, on) => {
  const world = await session($, on)
  const pane = await mountPane($)

  await pane.press({ key: 'f-user' })
  expect(await filters(pane)).toEqual(['全部', '*用户', 'Agent'])
  expect(await entryTexts(pane)).toEqual(['CT-SYN first', '/tui', 'CT-SYN third'])
  expect(world.store.viewFilter).toBe('user')

  /* The Agent filter hides the local command's group, which has no Agent side. */
  await pane.press({ key: 'f-agent' })
  expect(await entryTexts(pane)).toEqual(['CT-SYN first answer', 'CT-SYN third answer'])
  expect(world.store.viewFilter).toBe('agent')
})

test('the Layout Button goes from cards to compact to timeline and back, each remembered', async ($, on) => {
  const world = await session($, on)
  const pane = await mountPane($)
  const layoutLabel = async () => (await controls(pane)).find(c => c.key === 'layout')?.label

  await pane.press({ key: 'layout' })
  expect(await layoutLabel()).toBe('布局 紧凑')
  expect(world.store.layout).toBe('compact')
  expect((await entryTexts(pane))[0]).toBe('CT-SYN first')

  await pane.press({ key: 'layout' })
  expect(await layoutLabel()).toBe('布局 时间轴')
  expect(world.store.layout).toBe('timeline')
  expect(await entryTexts(pane)).toEqual(['CT-SYN first', 'CT-SYN first answer', '/tui', 'CT-SYN third', 'CT-SYN third answer'])

  await pane.press({ key: 'layout' })
  expect(await layoutLabel()).toBe('布局 卡片')
  expect(world.store.layout).toBe('card')
})

test('a new session draws with the filter and Layout chosen in an earlier one', async ($, on) => {
  await session($, on, { viewFilter: 'agent', layout: 'timeline' })
  const pane = await mountPane($)

  expect(await filters(pane)).toEqual(['全部', '用户', '*Agent'])
  expect((await controls(pane)).find(c => c.key === 'layout')?.label).toBe('布局 时间轴')
  expect(await entryTexts(pane)).toEqual(['CT-SYN first answer', 'CT-SYN third answer'])
})

test('stored values chat-toc does not know draw all sides as cards', async ($, on) => {
  await session($, on, { viewFilter: 'everything', layout: 7 })
  const pane = await mountPane($)

  expect(await filters(pane)).toEqual(['*全部', '用户', 'Agent'])
  expect((await controls(pane)).find(c => c.key === 'layout')?.label).toBe('布局 卡片')
})

test('a store that refuses the choice still switches, this time', async ($, on) => {
  const world = await session($, on)
  world.refuseStore = true
  const pane = await mountPane($)

  await pane.press({ key: 'layout' })
  await pane.press({ key: 'f-agent' })

  expect(await filters(pane)).toEqual(['全部', '用户', '*Agent'])
  expect((await controls(pane)).find(c => c.key === 'layout')?.label).toBe('布局 紧凑')
  expect(world.store.layout).toBeUndefined()
})
