import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { PANE, appendRow, drawnButtons, host, isBarKey, isEntryKey, mountPane, start, openOn } from './host'
import { transcript } from './fixture'

/* CT-PREV-002's automated half: the expanded preview (0.2 spec §3 "Expanded",
   "Text cap"). The worlds speak Chinese (host.ts). */

const LONG = Array.from({ length: 30 }, (_, i) => `CT-SYN line ${i}`).join('\n')

/* Six groups, so the Minimap is drawn; the third has a long reply and
   touched files. */
function six() {
  const t = transcript()
  for (let i = 0; i < 6; i++) {
    t.prompt(`CT-SYN p${i}`)
    if (i !== 2) {
      t.reply([{ type: 'text', text: `CT-SYN a${i}` }])
      continue
    }
    t.row({ type: 'assistant', message: { id: 'm-read', role: 'assistant', content: [{ type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: '/home/synthetic/project/src/a.ts' } }] } })
    t.toolResult('r1')
    t.row({ type: 'assistant', message: { id: 'm-edit', role: 'assistant', content: [{ type: 'tool_use', id: 'e1', name: 'Edit', input: { file_path: '/home/synthetic/project/hooks/pane.tsx' } }] } })
    t.toolResult('e1')
    t.row({ type: 'assistant', message: { id: 'm-write', role: 'assistant', content: [{ type: 'tool_use', id: 'w1', name: 'Write', input: { file_path: '/home/synthetic/notes/todo.md' } }] } })
    t.toolResult('w1')
    t.reply([{ type: 'text', text: LONG }])
  }
  return t
}

type Pane = Awaited<ReturnType<typeof mountPane>>
const texts = async (pane: Pane) => (await pane.findAll({ type: 'Text' })).map(t => t.text)
const keys = async (pane: Pane) => drawnButtons(await pane.drawn()).map(b => b.key)
const markdown = async (pane: Pane) => (await pane.findAll({ type: 'Markdown' })).map(m => m.props.text)

const arrow = ($: Engine, element: string) =>
  $.ui.focus({ component: 'Pane', requestId: PANE, element, origin: { kind: 'person' } } as never)

function focusedPane($: Engine, bodyRows = 30) {
  return $.ui.mount({
    plugin: 'chat-toc',
    surface: 'terminal',
    component: 'Pane',
    requestId: PANE,
    viewport: { columns: 160, rows: 40, isFullscreen: true },
    props: { title: '目录', isFocused: true, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows }, view: {} },
  })
}

/* The pane with the keys, the preview opened by a press on the group with
   the long reply. */
async function onLong($: Engine, world: ReturnType<typeof host>) {
  const pane = await focusedPane($)
  await arrow($, 'g2.u')
  await openOn(pane, 'g2.u')
  await world.clock.advance(1)
  return pane
}

test('e expands the preview over the list and the Minimap; the filter row and the footer stay; ← Back returns', async ($, on) => {
  const world = host(on, six().jsonl())
  await start($, world)
  const pane = await onLong($, world)
  expect((await keys(pane)).some(isBarKey)).toBe(true)

  await pane.press({ key: 'preview.more' })
  const drawn = await keys(pane)
  expect(drawn.some(isEntryKey)).toBe(false)
  expect(drawn.some(isBarKey)).toBe(false)
  expect(drawn).toContain('f-all')
  expect(drawn).toContain('layout')
  const back = await pane.find({ type: 'Button', key: 'preview.back' })
  expect([back?.text, back?.props.hotkey, back?.props.plain]).toEqual(['← 返回', 'e', true])
  expect(await texts(pane)).toContain('CT-SYN p2')
  expect(await markdown(pane)).toEqual([LONG])

  await pane.press({ key: 'preview.back' })
  const again = await keys(pane)
  expect(again.some(isEntryKey)).toBe(true)
  expect(again).toContain('preview.more')
  expect(again).not.toContain('preview.back')
})

test('expanded, the ✕ at the right of the Back row closes the preview: the list comes back with no region', async ($, on) => {
  const world = host(on, six().jsonl())
  await start($, world)
  const pane = await onLong($, world)
  await pane.press({ key: 'preview.more' })

  const close = await pane.find({ type: 'Button', key: 'preview' })
  expect([close?.text, close?.props.hotkey]).toEqual(['✕', 'p'])
  await pane.press({ key: 'preview' })
  const drawn = await keys(pane)
  expect(drawn.some(isEntryKey)).toBe(true)
  expect(drawn).not.toContain('preview.back')
  expect(drawn).not.toContain('preview')
  expect(drawn).not.toContain('preview.more')
})

test('expanded, the files are one per line under 改过 and 读过, relative to the project or with ~', async ($, on) => {
  const world = host(on, six().jsonl())
  world.env.HOME = '/home/synthetic'
  await start($, world)
  const pane = await onLong($, world)
  await pane.press({ key: 'preview.more' })

  const shown = await texts(pane)
  const at = shown.indexOf('改过')
  expect(shown.slice(at, at + 5)).toEqual(['改过', 'hooks/pane.tsx', '~/notes/todo.md', '读过', 'src/a.ts'])
})

test('a 200,000-character pasted input is cut by the cap with a line saying so; the tree stays under 100,000 characters and the footer draws', async ($, on) => {
  const t = transcript()
  t.prompt('CT-SYN short')
  t.reply([{ type: 'text', text: 'CT-SYN short answer' }])
  const pasted = Array.from({ length: 4_000 }, (_, i) => `CT-SYN pasted line ${String(i).padStart(4, '0')} ${'x'.repeat(26)}`).join('\n')
  expect(pasted.length).toBeGreaterThanOrEqual(200_000)
  t.prompt(pasted)
  t.reply([{ type: 'text', text: LONG }])
  const world = host(on, t.jsonl())
  await start($, world)
  const pane = await mountPane($)

  await openOn(pane, 'g1.u')
  await pane.press({ key: 'preview.more' })
  const shown = await texts(pane)
  const cut = shown.find(s => s.startsWith('… 还有 '))
  expect(cut).toMatch(/^… 还有 \d{3},\d{3} 字未显示 · c: 复制$/)
  expect(await markdown(pane)).toEqual([LONG])
  const characters = [...shown, ...(await markdown(pane))].reduce((n: number, s) => n + String(s).length, 0)
  expect(characters).toBeLessThan(100_000)
  /* 2.1.287 refuses the whole tree for one text child over 10,000 characters. */
  expect(shown.every(s => s.length <= 10_000)).toBe(true)
  expect(await keys(pane)).toContain('layout')
})

test('expanded on a running group, it is redrawn as the group grows', async ($, on) => {
  const t = transcript()
  t.prompt('CT-SYN earlier')
  t.reply([{ type: 'text', text: LONG }])
  const world = host(on, t.jsonl())
  await start($, world)
  const pane = await mountPane($)

  await $.turn.start({ text: 'CT-SYN working', turnId: 'turn-1' })
  const asked = t.prompt('CT-SYN working')
  const first = t.reply([{ type: 'text', text: LONG }, { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/home/synthetic/project/a.ts' } }])
  world.file = t.jsonl()
  await appendRow($, asked)
  await appendRow($, first)
  await world.clock.advance(300)
  await openOn(pane, 'g1.u')
  await pane.press({ key: 'preview.more' })
  expect(await markdown(pane)).toEqual([LONG])

  const more = t.reply([{ type: 'text', text: 'CT-SYN found it' }])
  world.file = t.jsonl()
  await appendRow($, more)
  await world.clock.advance(300)
  expect(await markdown(pane)).toEqual(['CT-SYN found it'])
  expect((await texts(pane)).some(s => s.endsWith('· 进行中 · 1 步'))).toBe(true)
})

const scroll = ($: Engine, by: number) =>
  $.ui.scroll({ component: 'Pane', requestId: PANE, offset: Math.max(0, by), by, bodyRows: 30, contentRows: 80, origin: { kind: 'person' } } as never)

test("expanded, the person's scrolls pass to the host, which scrolls the tree; back, the pane keeps its own window again", async ($, on) => {
  const world = host(on, six().jsonl())
  await start($, world)
  const pane = await onLong($, world)

  await pane.press({ key: 'preview.more' })
  await scroll($, 3)
  expect(world.scrolls.length).toBe(1)

  await pane.press({ key: 'preview.back' })
  await scroll($, -3)
  expect(world.scrolls.length).toBe(1)
})

test('the keys leaving the pane return it to the list', async ($, on) => {
  const world = host(on, six().jsonl())
  await start($, world)
  const pane = await onLong($, world)
  await pane.press({ key: 'preview.more' })
  expect(await keys(pane)).toContain('preview.back')

  await pane.redraw({ title: '目录', isFocused: false, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} })
  expect(await keys(pane)).not.toContain('preview.back')
  expect((await keys(pane)).some(isEntryKey)).toBe(true)
})

test('expanded, it holds its group: the ring moving and a new turn change nothing', async ($, on) => {
  const t = six()
  const world = host(on, t.jsonl())
  await start($, world)
  const pane = await onLong($, world)
  await pane.press({ key: 'preview.more' })

  await arrow($, 'g4.u')
  await world.clock.advance(1)
  t.prompt('CT-SYN p6')
  const row = t.reply([{ type: 'text', text: 'CT-SYN a6' }])
  world.file = t.jsonl()
  await appendRow($, row)
  await world.clock.advance(300)
  expect(await texts(pane)).toContain('CT-SYN p2')
  expect(await markdown(pane)).toEqual([LONG])
})
