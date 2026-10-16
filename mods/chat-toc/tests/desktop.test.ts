import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { PANE, drawnButtons, host, isEntryKey, start } from './host'
import { ROW_PX } from '../hooks/desktop'
import type { Builder } from './fixture'
import { transcript } from './fixture'

/* The pane on Claude Code Desktop (and the other remote surfaces), drawn
   with what the desktop was measured to draw (ticket 36): a plain Button is
   one line of bare text, so every line of an entry is one; what only
   decorates (the rail, the strip, the filters' well) is an Svg. */

function three() {
  const t = transcript(new Date(2026, 9, 10, 9, 4).getTime())
  t.prompt('CT-SYN first, a prompt long enough that a terminal pane would fold it onto a second line')
  t.reply([{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }])
  t.toolResult('t1')
  t.reply([{ type: 'text', text: 'CT-SYN first answer' }])
  t.localCommand('tui', '')
  t.prompt('CT-SYN third')
  t.reply([{ type: 'text', text: 'CT-SYN third answer' }])
  return t
}

function desktopPane($: Engine, isFocused = false) {
  return $.ui.mount({
    plugin: 'chat-toc',
    surface: 'desktop',
    component: 'Pane',
    requestId: PANE,
    props: { title: '目录', isFocused, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  } as never)
}

type Pane = Awaited<ReturnType<typeof desktopPane>>
type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

async function all(pane: Pane, type: string): Promise<Node[]> {
  const out: Node[] = []
  const walk = (node: unknown) => {
    if (typeof node !== 'object' || node === null) return
    const el = node as Node
    if (el.type === type) out.push(el)
    for (const child of el.children ?? []) walk(child)
  }
  walk(await pane.drawn())
  return out
}

const svgs = async (pane: Pane) => (await all(pane, 'Svg')).map(s => ({ alt: String(s.props?.alt), source: String(s.props?.source), height: s.props?.height }))

test('the filters are plain buttons over a drawn well, the chosen one not dim; no hotkeys', async ($, on) => {
  await start($, host(on, three().jsonl()))
  const pane = await desktopPane($)

  const filters = drawnButtons(await pane.drawn()).filter(b => String(b.key).startsWith('f-'))
  expect(filters.map(b => [b.key, b.plain, b.dimColor === true])).toEqual([
    ['f-all', true, false],
    ['f-user', true, true],
    ['f-agent', true, true],
  ])
  expect((await all(pane, 'Button')).some(b => b.props?.hotkey !== undefined)).toBe(false)
  expect((await svgs(pane)).some(s => s.alt === '筛选：全部')).toBe(true)
})

test('the Layout is a select of the three without a label, and picking one switches and is remembered', async ($, on) => {
  const world = host(on, three().jsonl())
  await start($, world)
  const pane = await desktopPane($)

  const select = (await all(pane, 'Select'))[0]
  expect(select?.props?.value).toBe('card')
  expect(select?.props?.label).toBeUndefined()
  expect(select?.props?.options).toEqual([
    { value: 'card', label: '卡片' },
    { value: 'compact', label: '紧凑' },
    { value: 'timeline', label: '时间轴' },
  ])
  /* 2.1.287's kit types no `select`; the suite runs on the current host. */
  await (pane as unknown as { select: (target: { key: string; value: string }) => Promise<unknown> }).select({ key: 'layout', value: 'timeline' })
  expect((await all(pane, 'Select'))[0]?.props?.value).toBe('timeline')
  expect(world.store.layout).toBe('timeline')
})

test('a strip of bars stands above the list, one per Turn group, the first day and time, the count and the last time under it', async ($, on) => {
  await start($, host(on, three().jsonl()))
  const pane = await desktopPane($)

  const strip = (await svgs(pane)).find(s => s.alt.startsWith('3 轮'))
  expect(strip).toBeDefined()
  expect((strip!.source.match(/<rect class="[brl]"/g) ?? []).length).toBe(3)
  expect(strip!.source).toContain('>10月10日 09:05<')
  expect(strip!.source).toContain('>3 轮<')
  expect(strip!.source).toMatch(/>09:\d\d<\/text><\/svg>$/)
})

test('every line of an entry is a plain button, the user side at full strength, the agent side dim', async ($, on) => {
  await start($, host(on, three().jsonl()))
  const pane = await desktopPane($)

  const lines = drawnButtons(await pane.drawn()).filter(b => isEntryKey(b.key))
  expect(lines.map(b => b.key)).toEqual(['g0.u', 'g0.u.1', 'g0.a', 'g1.u', 'g2.u', 'g2.a'])
  expect(lines.every(b => b.plain === true)).toBe(true)
  expect(lines.map(b => b.dimColor === true)).toEqual([false, false, true, false, false, true])
  const texts = (await pane.findAll({ type: 'Button' })).filter(b => isEntryKey(b.key)).map(b => b.text)
  expect(texts[0]).toContain('CT-SYN first')
  expect(texts[2]).toBe('1 步 · CT-SYN first answer')
})

test('each entry hangs on a drawn rail as tall as its lines; the day is a drawn rule', async ($, on) => {
  await start($, host(on, three().jsonl()))
  const pane = await desktopPane($)

  const all3 = await svgs(pane)
  const rails = all3.filter(s => s.alt === '轨道')
  expect(rails.map(s => s.height)).toEqual([2 * ROW_PX, ROW_PX, ROW_PX, ROW_PX, ROW_PX, ROW_PX, ROW_PX])
  expect(all3.some(s => s.alt === '今天 · 10月10日' && s.source.includes('>今天 · 10月10日<'))).toBe(true)
})

/* The 0.2 additions on the desktop (spec §8). */

const type = ($: Engine, text: string) => $.ui.input({ plugin: 'chat-toc', key: 'search', text, kind: 'change' })
const enter = ($: Engine, text: string) => $.ui.input({ plugin: 'chat-toc', key: 'search', text })
const entryKeys = async (pane: Pane) => drawnButtons(await pane.drawn()).filter(b => isEntryKey(b.key)).map(b => b.key)

test('a native search field sits under the segmented control, with no f Button, no hotkey and no ‹ ›', async ($, on) => {
  await start($, host(on, three().jsonl()))
  const pane = await desktopPane($)

  const field = (await all(pane, 'Input'))[0]
  expect(field?.props?.placeholder).toBe('词或文件路径')
  expect(field?.props?.submitLabel).toBe('预览')
  expect(field?.props?.value).toBe('')
  expect(field?.props?.autoFocus).toBeUndefined()
  const keys = drawnButtons(await pane.drawn()).map(b => b.key)
  expect(keys).not.toContain('find')
  expect(keys).not.toContain('step.previous')
  expect(keys).not.toContain('step.next')
  expect((await all(pane, 'Button')).some(b => b.props?.hotkey !== undefined || b.props?.action !== undefined)).toBe(false)
  /* Under the filters and the Layout, above the strip. */
  const order = JSON.stringify(await pane.drawn())
  expect(order.indexOf('"Select"')).toBeLessThan(order.indexOf('"Input"'))
  expect(order.indexOf('"Input"')).toBeLessThan(order.indexOf('轮，每轮一根竖条'))
})

test('each change filters the list; the strip draws the matches in the accent colour and the rest dim', async ($, on) => {
  const world = host(on, three().jsonl())
  await start($, world)
  const pane = await desktopPane($)

  await type($, 'third')
  await world.clock.settle()
  expect((await all(pane, 'Input'))[0]?.props?.value).toBe('third')
  expect(await entryKeys(pane)).toEqual(['g2.u', 'g2.a'])
  const strip = (await svgs(pane)).find(s => s.alt.startsWith('3 轮'))!
  expect((strip.source.match(/<rect class="[a-z]"/g) ?? []).map(r => r.slice(13, 14))).toEqual(['d', 'd', 'm'])
  expect(strip.source).toMatch(/\.m\{fill:/)
})

