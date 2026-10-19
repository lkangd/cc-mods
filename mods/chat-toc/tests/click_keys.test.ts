import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { PANE, drawnButtons, host, mountPane, start } from './host'
import { transcript } from './fixture'
import { claimsKeys } from '../hooks/pane'

/* A click presses a terminal Button and leaves the keys in the composer;
   after the press the pane asks for them, so `c` copies at once. */

function two() {
  const t = transcript()
  t.prompt('CT-SYN first')
  t.reply([{ type: 'text', text: 'CT-SYN first answer' }])
  t.prompt('CT-SYN second')
  t.reply([{ type: 'text', text: 'CT-SYN second answer' }])
  return t
}

const focusedOpens = (opens: readonly { focus?: true }[]) => opens.filter(o => o.focus === true).length

test('Reuse and ‹ › keep the keys where they are; every other press asks for them', () => {
  expect(claimsKeys('g1.u')).toBe(true)
  expect(claimsKeys('g1.u:copy')).toBe(true)
  expect(claimsKeys('preview.copy.user')).toBe(true)
  expect(claimsKeys('g1.u:reuse')).toBe(false)
  expect(claimsKeys('preview.reuse')).toBe(false)
  expect(claimsKeys('walk.previous')).toBe(false)
  expect(claimsKeys('walk.next')).toBe(false)
})

test('a press on an entry of the unfocused pane asks for the keys', async ($, on) => {
  const world = host(on, two().jsonl())
  await start($, world)
  const pane = await mountPane($)
  const entry = drawnButtons(await pane.drawn()).map(b => String(b.key)).find(k => /^g\d+\.u$/.test(k))!
  const before = focusedOpens(world.opens)

  await pane.press({ key: entry })

  expect(focusedOpens(world.opens)).toBe(before + 1)
  expect(world.opens.at(-1)).toMatchObject({ id: PANE, focus: true })
})

test('a press on the focused pane asks for nothing', async ($, on) => {
  const world = host(on, two().jsonl())
  await start($, world)
  const pane = await mountPane($)
  const entry = drawnButtons(await pane.drawn()).map(b => String(b.key)).find(k => /^g\d+\.u$/.test(k))!
  world.panes = world.panes.map(p => (p.id === PANE ? { ...p, isFocused: true } : p))
  const before = world.opens.length

  await pane.press({ key: entry })

  expect(world.opens.length).toBe(before)
})

const DESKTOP_PROPS = { title: '目录', isFocused: false, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} }

function desktopPane($: Engine) {
  return $.ui.mount({ plugin: 'chat-toc', surface: 'desktop', component: 'Pane', requestId: PANE, props: DESKTOP_PROPS } as never)
}

/* Every Button's press handle, by key, as the surface holds the tree. */
async function handles(pane: Awaited<ReturnType<typeof desktopPane>>): Promise<Map<string, unknown>> {
  const out = new Map<string, unknown>()
  const walk = (node: unknown): void => {
    if (typeof node !== 'object' || node === null) return
    const n = node as { type?: string; props?: { key?: string }; press?: { handle?: unknown }; children?: unknown[] }
    if (n.type === 'Button' && n.props?.key !== undefined) out.set(n.props.key, n.press?.handle)
    for (const child of n.children ?? []) walk(child)
  }
  walk(await pane.drawn())
  return out
}

test('a press on the desktop asks for nothing', async ($, on) => {
  const world = host(on, two().jsonl())
  await start($, world)
  const pane = await desktopPane($)
  const before = world.opens.length

  await pane.press({ key: 'f-user' })

  expect(world.opens.length).toBe(before)
})

/* The click that brings the focus reaches the host after the drawing the
   focus asked for: its Button must keep the handle it was drawn with. */
test('on the desktop the focus coming or going keeps every Button its handle', async ($, on) => {
  await start($, host(on, two().jsonl()))
  const pane = await desktopPane($)
  const drawn = await handles(pane)

  await pane.redraw({ ...DESKTOP_PROPS, isFocused: true } as never)
  expect(await handles(pane)).toEqual(drawn)

  await pane.redraw({ ...DESKTOP_PROPS, isFocused: false } as never)
  expect(await handles(pane)).toEqual(drawn)
  expect(drawn.size).toBeGreaterThan(0)
})

test('on the desktop a change the person made draws Buttons anew', async ($, on) => {
  await start($, host(on, two().jsonl()))
  const pane = await desktopPane($)
  const drawn = await handles(pane)

  await pane.press({ key: 'f-user' })

  expect((await handles(pane)).get('f-user')).not.toEqual(drawn.get('f-user'))
})
