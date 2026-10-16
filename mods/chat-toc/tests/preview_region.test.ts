import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { PANE, appendRow, drawnButtons, host, mountPane, start } from './host'
import type { Host } from './host'
import { transcript } from './fixture'

/* CT-PREV-001's automated half: the preview region at the bottom of the
   terminal Pane (spec §1, §3). The worlds speak Chinese (host.ts). */

function two() {
  const t = transcript(new Date(2026, 9, 10, 9, 0).getTime())
  t.prompt('CT-SYN 第一个问题')
  t.reply([{ type: 'text', text: 'CT-SYN 第一个回答' }])
  t.prompt('CT-SYN second **prompt**')
  t.row({
    type: 'assistant',
    message: { id: 'm2', role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: '/home/synthetic/project/hooks/pane.tsx' } }], usage: { output_tokens: 1_200 } },
  })
  t.toolResult('t1')
  t.row({ type: 'assistant', message: { id: 'm3', role: 'assistant', content: [{ type: 'text', text: '## CT-SYN done\n\n- `one`' }], usage: { output_tokens: 300 } } })
  t.row({ type: 'system', subtype: 'turn_duration', durationMs: 45_000 })
  return t
}

const texts = async (pane: Awaited<ReturnType<typeof mountPane>>) => (await pane.findAll({ type: 'Text' })).map(t => t.text)

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

const arrow = ($: Engine, element: string) => $.ui.focus({ component: 'Pane', requestId: PANE, element, origin: { kind: 'person' } } as never)

test('the region sits above the footer: its rule, the meta line, the User input as typed, the last text as Markdown and the files line', async ($, on) => {
  await start($, host(on, two().jsonl()))
  const pane = await mountPane($)

  const keys = drawnButtons(await pane.drawn()).map(b => b.key)
  expect(keys.slice(-2)).toEqual(['preview', 'layout'])
  const rule = await pane.find({ type: 'Button', key: 'preview' })
  expect([rule?.text, rule?.props.hotkey, rule?.props.plain]).toEqual(['预览', 'p', true])
  const shown = await texts(pane)
  expect(shown).toContain('10月10日 09:03 · 1 步 · 45 秒 · 输出 1.5k')
  expect(shown).toContain('用户')
  expect(shown).toContain('CT-SYN second **prompt**')
  expect(shown).toContain('Agent')
  expect(shown).toContain('改 hooks/pane.tsx')
  expect((await pane.find({ type: 'Markdown' }))?.props.text).toBe('## CT-SYN done\n\n- `one`')
})

test('with the keyboard in the Pane the preview shows the selected group; given back, the newest when nothing is lit', async ($, on) => {
  const world = host(on, two().jsonl())
  await start($, world)
  const pane = await focusedPane($)

  await arrow($, 'g0.u')
  await world.clock.advance(1)
  expect(await texts(pane)).toContain('CT-SYN 第一个问题')
  expect((await pane.find({ type: 'Markdown' }))?.props.text).toBe('CT-SYN 第一个回答')

  await arrow($, 'g1.a')
  await world.clock.advance(1)
  expect(await texts(pane)).toContain('CT-SYN second **prompt**')

  await pane.redraw({ title: '目录', isFocused: false, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} })
  expect(await texts(pane)).toContain('CT-SYN second **prompt**')
})

test('p folds the preview to its rule line and back, kept in the store; a value not known reads as shown', async ($, on) => {
  const world = host(on, two().jsonl(), undefined, { preview: 'sideways' })
  await start($, world)
  const pane = await mountPane($)
  expect(await pane.find({ type: 'Markdown' })).toBeDefined()

  await pane.press({ key: 'preview' })
  expect(world.store.preview).toBe('hidden')
  expect(await pane.find({ type: 'Markdown' })).toBeUndefined()
  expect(await texts(pane)).not.toContain('用户')
  const folded = await pane.find({ type: 'Button', key: 'preview' })
  expect([folded?.text, folded?.props.hotkey, folded?.props.dimColor]).toEqual(['预览', 'p', true])

  await pane.press({ key: 'preview' })
  expect(world.store.preview).toBe('shown')
  expect(await pane.find({ type: 'Markdown' })).toBeDefined()
})

test('a hidden preview stays hidden in the next session', async ($, on) => {
  const world: Host = host(on, two().jsonl(), undefined, { preview: 'hidden' })
  await start($, world)
  const pane = await mountPane($)
  expect(await pane.find({ type: 'Markdown' })).toBeUndefined()
  expect((await pane.find({ type: 'Button', key: 'preview' }))?.text).toBe('预览')
})

test('content past the region is cut, the last row saying how many lines are left with the e Button', async ($, on) => {
  const t = transcript()
  t.prompt('CT-SYN short')
  t.reply([{ type: 'text', text: Array.from({ length: 30 }, (_, i) => `CT-SYN line ${i}`).join('\n') }])
  await start($, host(on, t.jsonl()))
  /* 30 rows: 26 left after the head and the footer, the region 10. */
  const pane = await mountPane($)

  const more = await pane.find({ type: 'Button', key: 'preview.more' })
  expect([more?.text, more?.props.hotkey]).toEqual(['展开', 'e'])
  /* 10 rows: the rule, the meta line, User and its line, Agent and 4 lines, the cut line: 26 lines left out. */
  expect(await texts(pane)).toContain('↓ 还有 26 行 · ')
  expect((await pane.find({ type: 'Markdown' }))?.props.text).toBe('CT-SYN line 0\nCT-SYN line 1\nCT-SYN line 2\nCT-SYN line 3')
})

test('at a short height the Minimap goes first, then the preview shrinks to 4 rows, then leaves one line; the list keeps 8 rows', async ($, on) => {
  const t = transcript()
  for (let i = 0; i < 6; i++) {
    t.prompt(`CT-SYN p${i}`)
    t.reply([{ type: 'text', text: `CT-SYN a${i}` }])
  }
  await start($, host(on, t.jsonl()))
  const bars = async (pane: Awaited<ReturnType<typeof mountPane>>) => drawnButtons(await pane.drawn()).some(b => /^m\.\d+$/.test(String(b.key)))

  const rows = (bodyRows: number) => ({ title: '目录', isFocused: false, bodyColumns: 44, placement: 'dock' as const, scroll: { offset: 0, bodyRows }, view: {} })
  /* 23 rows: 18 left, the region 7, the Minimap 3, the list 8. */
  const pane = await mountPane($, 23)
  expect(await bars(pane)).toBe(true)
  expect(await pane.find({ type: 'Markdown' })).toBeDefined()

  /* 17 rows: 12 left, the Minimap gone, the region 4. */
  await pane.redraw(rows(17))
  expect(await bars(pane)).toBe(false)
  expect(await texts(pane)).toContain('用户')

  /* 16 rows: no room. */
  await pane.redraw(rows(16))
  const tiny = pane
  expect((await tiny.find({ type: 'Button', key: 'preview' }))?.text).toBe('预览（空间不足）')
  expect(await texts(tiny)).not.toContain('用户')
})

test('a running group is redrawn as rows arrive, with the latest text written so far', async ($, on) => {
  const t = transcript()
  t.prompt('CT-SYN earlier')
  t.reply([{ type: 'text', text: 'CT-SYN earlier answer' }])
  const world = host(on, t.jsonl())
  await start($, world)
  const pane = await mountPane($)

  await $.turn.start({ text: 'CT-SYN working', turnId: 'turn-1' })
  const asked = t.prompt('CT-SYN working')
  world.file = t.jsonl()
  await appendRow($, asked)
  await world.clock.advance(300)
  expect((await texts(pane)).some(s => s.endsWith('· 进行中'))).toBe(true)
  expect(await pane.find({ type: 'Markdown' })).toBeUndefined()

  const call = t.reply([{ type: 'text', text: 'CT-SYN looking first' }, { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/home/synthetic/project/a.ts' } }])
  world.file = t.jsonl()
  await appendRow($, call)
  await world.clock.advance(300)
  expect((await texts(pane)).some(s => s.endsWith('· 进行中 · 1 步'))).toBe(true)
  expect((await pane.find({ type: 'Markdown' }))?.props.text).toBe('CT-SYN looking first')
  expect(await texts(pane)).toContain('读 1')
})
