import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { PANE, drawnButtons, host, isEntryKey, start } from './host'
import { transcript } from './fixture'

/* The pane on Claude Code Desktop (and the other remote surfaces): the
   same list drawn with the surface's own controls. The filters are buttons,
   the chosen one primary; the Layout a select; a strip of bars, one per
   Turn group, above the list; each side one button holding its whole text,
   which the surface wraps. */

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

function desktopPane($: Engine) {
  return $.ui.mount({
    plugin: 'chat-toc',
    surface: 'desktop',
    component: 'Pane',
    requestId: PANE,
    props: { title: '目录', isFocused: false, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
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

test('the filters are buttons, the chosen one primary', async ($, on) => {
  await start($, host(on, three().jsonl()))
  const pane = await desktopPane($)

  const filters = (await all(pane, 'Button')).filter(b => String(b.props?.key).startsWith('f-'))
  expect(filters.map(b => [b.props?.key, b.props?.label, b.props?.variant])).toEqual([
    ['f-all', '全部', 'primary'],
    ['f-user', '用户', 'secondary'],
    ['f-agent', 'Agent', 'secondary'],
  ])
})

test('the Layout is a select of the three, and picking one switches and is remembered', async ($, on) => {
  const world = host(on, three().jsonl())
  await start($, world)
  const pane = await desktopPane($)

  const select = (await all(pane, 'Select'))[0]
  expect(select?.props?.value).toBe('card')
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

test('a strip of bars stands above the list, one per Turn group', async ($, on) => {
  await start($, host(on, three().jsonl()))
  const pane = await desktopPane($)

  const svg = (await all(pane, 'Svg'))[0]
  expect(svg?.props?.alt).toBe('3 轮，每轮一根竖条，高度按步数')
  expect((String(svg?.props?.source).match(/<rect /g) ?? []).length).toBe(3)
})

test('each side is one button with its whole text, unfolded; the Agent reply says its state first', async ($, on) => {
  await start($, host(on, three().jsonl()))
  const pane = await desktopPane($)

  expect(drawnButtons(await pane.drawn()).filter(b => isEntryKey(b.key)).map(b => [b.key, b.label])).toEqual([
    ['g0.u', 'CT-SYN first, a prompt long enough that a terminal pane would fold it onto a second line'],
    ['g0.a', '1 步 · CT-SYN first answer'],
    ['g1.u', '/tui'],
    ['g2.u', 'CT-SYN third'],
    ['g2.a', 'CT-SYN third answer'],
  ])
})

test("the day's rule and the count are said as text", async ($, on) => {
  await start($, host(on, three().jsonl()))
  const pane = await desktopPane($)

  expect(await pane.find({ type: 'Text', text: '今天 · 10月10日' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '3 轮' })).toBeDefined()
})
