import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { PANE, drawnButtons, host, isEntryKey, start } from './host'
import { ROW_PX } from '../hooks/desktop'
import type { Builder } from './fixture'
import { hasReuse } from '../hooks/reuse'
import { expandedBody } from '../hooks/preview'
import { setLanguage } from '../hooks/text'
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

const texts = async (pane: Pane) => (await pane.findAll({ type: 'Text' })).map(t => t.text)
const markdowns = async (pane: Pane) => (await all(pane, 'Markdown')).map(m => String(m.props?.text))

test('before any press the preview shows the newest group under a rule Button with no hotkey', async ($, on) => {
  await start($, host(on, three().jsonl()))
  const pane = await desktopPane($)

  const rule = await pane.find({ type: 'Button', key: 'preview' })
  expect([rule?.text, rule?.props.hotkey, rule?.props.plain]).toEqual(['预览', undefined, true])
  const shown = await texts(pane)
  expect(shown).toContain('用户')
  expect(shown).toContain('CT-SYN third')
  expect(shown.some(t => /^10月10日 \d\d:\d\d$/.test(t))).toBe(true)
  expect(await markdowns(pane)).toEqual(['CT-SYN third answer'])
  /* Below the list. */
  const order = JSON.stringify(await pane.drawn())
  expect(order.indexOf('"g2.a"')).toBeLessThan(order.indexOf('"preview"'))
})

test('the preview shows the last entry pressed', async ($, on) => {
  const world = host(on, three().jsonl())
  await start($, world)
  const pane = await desktopPane($)

  await pane.press({ key: 'g0.a' })
  await world.clock.settle()
  expect(await markdowns(pane)).toEqual(['CT-SYN first answer'])
  expect((await texts(pane)).some(t => t.startsWith('CT-SYN first, a prompt long enough'))).toBe(true)
})

test('while a query is set the preview shows the pressed match, else the newest; Enter puts the newest match there and keeps the text', async ($, on) => {
  const world = host(on, three().jsonl())
  await start($, world)
  const pane = await desktopPane($)

  await pane.press({ key: 'g0.u' })
  await type($, 'answer')
  await world.clock.settle()
  expect(await markdowns(pane)).toEqual(['CT-SYN first answer'])
  expect((await texts(pane)).some(t => t.startsWith('10月10日') && t.endsWith('匹配：Agent'))).toBe(true)

  await enter($, 'answer')
  await world.clock.settle()
  expect(await markdowns(pane)).toEqual(['CT-SYN third answer'])
  expect((await all(pane, 'Input'))[0]?.props?.value).toBe('answer')

  await type($, 'CT-SYN nowhere')
  await world.clock.settle()
  expect(await markdowns(pane)).toEqual([])
})

test('the rule Button hides and shows the preview, kept like the Layout', async ($, on) => {
  const world = host(on, three().jsonl())
  await start($, world)
  const pane = await desktopPane($)

  await pane.press({ key: 'preview' })
  await world.clock.settle()
  expect(world.store.preview).toBe('hidden')
  expect(await markdowns(pane)).toEqual([])
  expect((await pane.find({ type: 'Button', key: 'preview' }))?.props.dimColor).toBe(true)
  await pane.press({ key: 'preview' })
  await world.clock.settle()
  expect(world.store.preview).toBe('shown')
  expect(await markdowns(pane)).toEqual(['CT-SYN third answer'])
})

function long(): Builder {
  const t = three()
  t.prompt(Array.from({ length: 30 }, (_, i) => `CT-SYN line ${i + 1}`).join('\n'))
  t.reply([{ type: 'text', text: 'CT-SYN long answer' }])
  return t
}

test('the cut line is a Button without e:, expanding the preview; ← Back is a Button returning', async ($, on) => {
  const world = host(on, long().jsonl())
  await start($, world)
  const pane = await desktopPane($)

  const more = await pane.find({ type: 'Button', key: 'preview.more' })
  expect(more?.text).toMatch(/^↓ 还有 \d+ 行 · 展开$/)
  expect(more?.props.hotkey).toBeUndefined()
  await pane.press({ key: 'preview.more' })
  await world.clock.settle()
  const back = await pane.find({ type: 'Button', key: 'preview.back' })
  expect([back?.text, back?.props.hotkey]).toEqual(['← 返回', undefined])
  /* Uncut, in the list's place. */
  expect(await entryKeys(pane)).toEqual([])
  expect((await texts(pane)).some(t => t.includes('CT-SYN line 30'))).toBe(true)
  expect(await markdowns(pane)).toEqual(['CT-SYN long answer'])
  await pane.press({ key: 'preview.back' })
  await world.clock.settle()
  expect(await pane.find({ type: 'Button', key: 'preview.back' })).toBeUndefined()
  expect((await entryKeys(pane)).length).toBeGreaterThan(0)
})

test('each label row carries a 复制 Button with no hotkey and there is no Reuse; a press copies on the desktop and reads 已复制', async ($, on) => {
  const world = host(on, three().jsonl())
  on('session.version', () => ({ value: { version: '2.1.295', base: '2.1.295' } }))
  await start($, world)
  const pane = await desktopPane($)

  const user = await pane.find({ type: 'Button', key: 'preview.copy.user' })
  const agent = await pane.find({ type: 'Button', key: 'preview.copy.agent' })
  expect([user?.text, user?.props.hotkey, agent?.text, agent?.props.hotkey]).toEqual(['复制', undefined, '复制', undefined])
  expect(await pane.find({ type: 'Button', key: 'preview.reuse' })).toBeUndefined()

  await pane.press({ key: 'preview.copy.agent' })
  expect(world.copies).toEqual([{ text: 'CT-SYN third answer', surface: 'desktop' }])
  expect((await pane.find({ type: 'Button', key: 'preview.copy.agent' }))?.text).toBe('已复制')
})

test('a copy the desktop cannot take says it is too long', async ($, on) => {
  const world = host(on, three().jsonl())
  await start($, world)
  const pane = await desktopPane($)

  world.refuseCopy = 'no-clipboard'
  await pane.press({ key: 'preview.copy.user' })
  expect(world.toasts).toEqual(['太长，无法在此复制'])
})

test('Reuse on the desktop waits for a host that shows fills: off on every known version, on from the one named', () => {
  for (const base of ['2.1.287', '2.1.295', '2.1.300', '3.0.0', undefined]) expect(hasReuse('desktop', base)).toBe(false)
  expect(hasReuse('terminal', '2.1.287')).toBe(true)
  expect(hasReuse('terminal', undefined)).toBe(true)
  expect(hasReuse('desktop', '2.1.299', '2.1.300')).toBe(false)
  expect(hasReuse('desktop', '2.1.300', '2.1.300')).toBe(true)
  expect(hasReuse('desktop', '2.2.0', '2.1.300')).toBe(true)
  expect(hasReuse('desktop', '2.1.300-dev', '2.1.300')).toBe(true)
  expect(hasReuse('mobile', '2.2.0', '2.1.300')).toBe(false)
})

test('the expanded preview’s cap lines name no key on the desktop', () => {
  setLanguage('zh')
  const long = 'x'.repeat(70_000)
  const base = { meta: 'm', input: long, agent: long, files: { changed: [], read: [] }, base: { cwd: undefined, home: undefined }, width: 40 }
  const desktop = expandedBody({ ...base, hasHotkeys: false })
  expect(desktop.user.cut).toBe('… 还有 40,000 字未显示 · 复制')
  expect(desktop.agent?.cut).toBe('… 还有 40,000 字未显示 · 复制')
  expect(expandedBody(base).user.cut).toBe('… 还有 40,000 字未显示 · c: 复制')
  setLanguage('en')
  expect(expandedBody({ ...base, hasHotkeys: false }).agent?.cut).toBe('… 40,000 more characters not shown · Copy')
  setLanguage('zh')
})

const local = (iso: string) => {
  const at = new Date(iso)
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

test('a compaction is a dashed Svg rule placed as on the terminal, under every View filter', async ($, on) => {
  const t = transcript(new Date(2026, 9, 10, 9, 4).getTime())
  t.prompt('CT-SYN zero')
  t.reply([{ type: 'text', text: 'CT-SYN zero answer' }])
  const boundary = t.compact('manual')
  t.command('compact', '', 'local')
  t.prompt('CT-SYN after')
  t.reply([{ type: 'text', text: 'CT-SYN after answer' }])
  const time = local(t.rows.find(r => r.uuid === boundary)!.timestamp as string)
  const world = host(on, t.jsonl())
  await start($, world)
  const pane = await desktopPane($)

  const rules = (await svgs(pane)).filter(s => s.alt.startsWith('已压缩'))
  expect(rules.map(r => r.alt)).toEqual([`已压缩 ${time}`])
  expect(rules[0]!.source).toContain(`>已压缩 ${time}<`)
  expect(rules[0]!.source).toContain('stroke-dasharray')
  /* After the /compact entry, before the next group. */
  const drawn = JSON.stringify(await pane.drawn())
  expect(drawn.indexOf('"g1.u"')).toBeLessThan(drawn.indexOf(`"alt":"已压缩 ${time}"`))
  expect(drawn.indexOf(`"alt":"已压缩 ${time}"`)).toBeLessThan(drawn.indexOf('"g2.u"'))

  await pane.press({ key: 'f-agent' })
  await world.clock.settle()
  expect((await svgs(pane)).filter(s => s.alt.startsWith('已压缩')).length).toBe(1)
})

test('a file starting at a foreign boundary shows the fork line, dim, above the list', async ($, on) => {
  const t = transcript(new Date(2026, 9, 10, 9, 4).getTime())
  t.compact('manual')
  t.rows[0]!.logicalParentUuid = '99999999-0000-4000-8000-999999999999'
  t.command('compact', '', 'local')
  t.prompt('CT-SYN forked')
  t.reply([{ type: 'text', text: 'CT-SYN forked answer' }])
  await start($, host(on, t.jsonl()))
  const pane = await desktopPane($)

  const line = await pane.find({ type: 'Text', text: '更早的轮次不在本会话的文件里' })
  expect(line?.props.dimColor).toBe(true)
  const drawn = JSON.stringify(await pane.drawn())
  expect(drawn.indexOf('更早的轮次不在本会话的文件里')).toBeLessThan(drawn.indexOf('"g0.u"'))
})

test('the context use follows the count on the strip’s line only when the host gives a percent', async ($, on) => {
  const world = host(on, three().jsonl())
  await start($, world)
  const pane = await desktopPane($)
  const strip = async () => (await svgs(pane)).find(s => s.alt.startsWith('3 轮'))!.source

  expect(await strip()).toContain('>3 轮<')
  expect(await strip()).not.toContain('已用')
  await $.session.measure({ context: { window: 1_000_000, tokens: 620_000, percent: 62 }, rateLimits: [], changed: ['cost'] } as never)
  await world.clock.settle()
  expect(await strip()).toContain('>3 轮 · 上下文已用 62%<')
})

