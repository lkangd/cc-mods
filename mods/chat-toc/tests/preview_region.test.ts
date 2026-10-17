import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { PANE, appendRow, drawHint, drawnButtons, host, mountPane, start } from './host'
import { hostMessagesOf, rewoundTo, transcript } from './fixture'

/* CT-PREV-001's automated half: the preview region at the bottom of the
   terminal Pane (spec §1, §3), closed until a press on an entry. The
   worlds speak Chinese (host.ts). */

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

test('closed until a press: nothing of it is drawn, and a stored preview value from 0.2 builds is ignored', async ($, on) => {
  const world = host(on, two().jsonl(), undefined, { preview: 'shown' })
  await start($, world)
  const pane = await mountPane($)

  expect(await pane.find({ type: 'Button', key: 'preview' })).toBeUndefined()
  expect(await pane.find({ type: 'Markdown' })).toBeUndefined()
  expect(await texts(pane)).not.toContain('预览')
  expect(await texts(pane)).not.toContain('用户')
})

test('a press on an entry opens it on that group: the rule reads 预览 and ends in ✕ with p, then the meta line, the input, the last text and the files', async ($, on) => {
  const world = host(on, two().jsonl())
  await start($, world)
  const pane = await mountPane($)

  await pane.press({ key: 'g1.a' })
  const keys = drawnButtons(await pane.drawn()).map(b => b.key)
  expect(keys.slice(-5)).toEqual(['preview', 'preview.reuse', 'preview.copy.user', 'preview.copy.agent', 'layout'])
  const close = await pane.find({ type: 'Button', key: 'preview' })
  expect([close?.text, close?.props.hotkey, close?.props.plain]).toEqual(['✕', 'p', true])
  const shown = await texts(pane)
  expect(shown).toContain('预览')
  expect(shown).toContain('10月10日 09:03 · 1 步 · 45 秒 · 输出 1.5k')
  expect(shown).toContain('用户')
  expect(shown).toContain('CT-SYN second **prompt**')
  expect(shown).toContain('Agent')
  expect(shown).toContain('改 hooks/pane.tsx')
  expect((await pane.find({ type: 'Markdown' }))?.props.text).toBe('## CT-SYN done\n\n- `one`')
  expect(world.store.preview).toBeUndefined()
})

test('the rule spans the body: the dashes run up to the ✕ at its right end', async ($, on) => {
  await start($, host(on, two().jsonl()))
  const pane = await mountPane($)
  await pane.press({ key: 'g0.u' })

  /* 44 cells: `─ `, 预览 (4), a space, the dashes, a space, `p: ✕` (4). */
  const dashes = (await texts(pane)).find(t => /^ ─+ $/.test(t))
  expect(dashes?.length).toBe(44 - 2 - 4 - 4)
})

test('moving the focus ring opens nothing, and once open changes nothing; another press moves it', async ($, on) => {
  const world = host(on, two().jsonl())
  await start($, world)
  const pane = await focusedPane($)

  await arrow($, 'g0.u')
  await world.clock.advance(1)
  expect(await pane.find({ type: 'Button', key: 'preview' })).toBeUndefined()

  await pane.press({ key: 'g0.u' })
  expect(await texts(pane)).toContain('CT-SYN 第一个问题')
  await arrow($, 'g1.u')
  await world.clock.advance(1)
  expect((await pane.find({ type: 'Markdown' }))?.props.text).toBe('CT-SYN 第一个回答')

  await pane.press({ key: 'g1.u' })
  expect((await pane.find({ type: 'Markdown' }))?.props.text).toBe('## CT-SYN done\n\n- `one`')
})

test('a Minimap cell opens nothing', async ($, on) => {
  const t = transcript()
  for (let i = 0; i < 6; i++) {
    t.prompt(`CT-SYN p${i}`)
    t.reply([{ type: 'text', text: `CT-SYN a${i}` }])
  }
  await start($, host(on, t.jsonl()))
  const pane = await mountPane($)

  await pane.press({ key: 'm.0' })
  expect(await pane.find({ type: 'Button', key: 'preview' })).toBeUndefined()
  expect(await pane.find({ type: 'Markdown' })).toBeUndefined()
})

test('it holds the pressed group across a new turn, a View filter switch and a Layout switch', async ($, on) => {
  const t = two()
  const world = host(on, t.jsonl())
  await start($, world)
  const pane = await mountPane($)
  await pane.press({ key: 'g0.u' })

  t.prompt('CT-SYN third')
  const row = t.reply([{ type: 'text', text: 'CT-SYN third answer' }])
  world.file = t.jsonl()
  await appendRow($, row)
  await world.clock.advance(300)
  expect((await pane.find({ type: 'Markdown' }))?.props.text).toBe('CT-SYN 第一个回答')

  await pane.press({ key: 'f-user' })
  expect((await pane.find({ type: 'Markdown' }))?.props.text).toBe('CT-SYN 第一个回答')
  await pane.press({ key: 'layout' })
  expect((await pane.find({ type: 'Markdown' }))?.props.text).toBe('CT-SYN 第一个回答')
})

test('✕ closes it and p, its hotkey, is gone with it; nothing is kept', async ($, on) => {
  const world = host(on, two().jsonl())
  await start($, world)
  const pane = await mountPane($)
  await pane.press({ key: 'g1.u' })

  await pane.press({ key: 'preview' })
  expect(await pane.find({ type: 'Button', key: 'preview' })).toBeUndefined()
  expect(await pane.find({ type: 'Markdown' })).toBeUndefined()
  expect(await texts(pane)).not.toContain('预览')
  expect(Object.keys(world.store)).not.toContain('preview')
})

test('r, c, a and e work only while it is open: their Buttons are drawn only then', async ($, on) => {
  const t = transcript()
  t.prompt('CT-SYN short')
  t.reply([{ type: 'text', text: Array.from({ length: 30 }, (_, i) => `CT-SYN line ${i}`).join('\n') }])
  await start($, host(on, t.jsonl()))
  const pane = await mountPane($)
  const hotkeys = async () => (await pane.findAll({ type: 'Button' })).map(b => b.props.hotkey).filter(Boolean)

  expect(await hotkeys()).toEqual(['1', '2', '3', 'f', 'l'])
  await pane.press({ key: 'g0.u' })
  expect(await hotkeys()).toEqual(['1', '2', '3', 'f', 'p', 'r', 'c', 'a', 'e', 'l'])
  await pane.press({ key: 'preview' })
  expect(await hotkeys()).toEqual(['1', '2', '3', 'f', 'l'])
})

test('a rewind that takes its group closes it', async ($, on) => {
  const t = two()
  const world = host(on, t.jsonl())
  world.messages = hostMessagesOf(t)
  await start($, world)
  const pane = await mountPane($)
  await drawHint($)
  await world.clock.settle()
  await pane.press({ key: 'g1.u' })
  expect(await pane.find({ type: 'Button', key: 'preview' })).toBeDefined()

  world.messages = rewoundTo(world.messages, 'CT-SYN second **prompt**')
  await drawHint($)
  await world.clock.settle()
  expect(await pane.find({ type: 'Button', key: 'preview' })).toBeUndefined()
  expect(await pane.find({ type: 'Markdown' })).toBeUndefined()
})

test('/clear, another conversation, closes it', async ($, on) => {
  const world = host(on, two().jsonl())
  await start($, world)
  const pane = await mountPane($)
  await pane.press({ key: 'g1.u' })

  world.path = '/home/synthetic/.claude/projects/p/synthetic-next.jsonl'
  world.file = two().jsonl()
  await $.classic.SessionStart({ source: 'clear', transcript_path: world.path })
  await world.clock.settle()
  expect(await pane.find({ type: 'Button', key: 'preview' })).toBeUndefined()
})

test('at a short height a press opens it expanded; ← Back closes it, and ✕ closes it there too', async ($, on) => {
  const t = transcript()
  for (let i = 0; i < 6; i++) {
    t.prompt(`CT-SYN p${i}`)
    t.reply([{ type: 'text', text: `CT-SYN a${i}` }])
  }
  const world = host(on, t.jsonl())
  await start($, world)
  /* 16 rows: 11 left after the head, the search row and the footer; 4 do not fit beside the list's 8. */
  const pane = await mountPane($, 16)

  await pane.press({ key: 'g5.u' })
  const back = await pane.find({ type: 'Button', key: 'preview.back' })
  expect(back?.text).toBe('← 返回')
  expect(await texts(pane)).toContain('CT-SYN p5')
  expect((await pane.find({ type: 'Button', key: 'preview' }))?.text).toBe('✕')
  expect(await pane.find({ type: 'Button', key: 'g0.u' })).toBeUndefined()

  await pane.press({ key: 'preview.back' })
  expect(await pane.find({ type: 'Button', key: 'preview.back' })).toBeUndefined()
  expect(await pane.find({ type: 'Button', key: 'preview' })).toBeUndefined()
  expect(await pane.find({ type: 'Button', key: 'g5.u' })).toBeDefined()

  await pane.press({ key: 'g5.a' })
  expect(await pane.find({ type: 'Button', key: 'preview.back' })).toBeDefined()
  await pane.press({ key: 'preview' })
  expect(await pane.find({ type: 'Button', key: 'preview.back' })).toBeUndefined()
  expect(await pane.find({ type: 'Button', key: 'g5.a' })).toBeDefined()
})

test('content past the region is cut, the last row saying how many lines are left with the e Button', async ($, on) => {
  const t = transcript()
  t.prompt('CT-SYN short')
  t.reply([{ type: 'text', text: Array.from({ length: 30 }, (_, i) => `CT-SYN line ${i}`).join('\n') }])
  await start($, host(on, t.jsonl()))
  /* 30 rows: 26 left after the head and the footer, the region 10. */
  const pane = await mountPane($)
  await pane.press({ key: 'g0.u' })

  const more = await pane.find({ type: 'Button', key: 'preview.more' })
  expect([more?.text, more?.props.hotkey]).toEqual(['展开', 'e'])
  /* 10 rows: the rule, the meta line, User and its line, Agent and 4 lines, the cut line: 26 lines left out. */
  expect(await texts(pane)).toContain('↓ 还有 26 行 · ')
  expect((await pane.find({ type: 'Markdown' }))?.props.text).toBe('CT-SYN line 0\nCT-SYN line 1\nCT-SYN line 2\nCT-SYN line 3')
})

test("the region's height is set by the rows after the head, the search row and the footer, not by a note under the list", async ($, on) => {
  const t = transcript()
  t.prompt('CT-SYN short')
  t.reply([{ type: 'text', text: Array.from({ length: 30 }, (_, i) => `CT-SYN line ${i}`).join('\n') }])
  const world = host(on, t.jsonl())
  await start($, world)
  /* 32 rows: 27 left after the head, the search row and the footer, the
     region 11: the rule, the meta line, User and its line, Agent and 5
     lines, the cut line. */
  const pane = await mountPane($, 32)
  await world.clock.settle()
  await pane.press({ key: 'g0.u' })
  const cutLine = async () => (await texts(pane)).find(x => x.startsWith('↓ '))
  const before = await cutLine()
  expect(before).toBe('↓ 还有 25 行 · ')

  /* A line that is no row adds the note under the list; the region keeps its rows. */
  world.file = `${t.jsonl()}CT-SYN not a row\n`
  await appendRow($, 'CT-SYN appended')
  await world.clock.advance(300)
  expect(await texts(pane)).toContain('有 1 行无法识别，目录可能不完整')
  expect(await cutLine()).toBe(before)
})

test('at a short height the Minimap goes first, then the preview shrinks to 4 rows, then it is drawn expanded; the list keeps 8 rows', async ($, on) => {
  const t = transcript()
  for (let i = 0; i < 6; i++) {
    t.prompt(`CT-SYN p${i}`)
    t.reply([{ type: 'text', text: `CT-SYN a${i}` }])
  }
  const world = host(on, t.jsonl())
  await start($, world)
  const bars = async (pane: Awaited<ReturnType<typeof mountPane>>) => drawnButtons(await pane.drawn()).some(b => /^m\.\d+$/.test(String(b.key)))

  const rows = (bodyRows: number) => ({ title: '目录', isFocused: false, bodyColumns: 44, placement: 'dock' as const, scroll: { offset: 0, bodyRows }, view: {} })
  /* 23 rows: 18 left, the region 7, the Minimap 3, the list 8. */
  const pane = await mountPane($, 23)
  await pane.press({ key: 'g5.u' })
  /* The kit refuses the jump: its notice goes after a while. */
  await world.clock.advance(5000)
  expect(await bars(pane)).toBe(true)
  expect(await pane.find({ type: 'Markdown' })).toBeDefined()

  /* 17 rows: 12 left, the Minimap gone, the region 4. */
  await pane.redraw(rows(17))
  expect(await bars(pane)).toBe(false)
  expect(await texts(pane)).toContain('用户')

  /* 16 rows: no room for the region; it is drawn expanded, with no line of the region. */
  await pane.redraw(rows(16))
  expect(await pane.find({ type: 'Button', key: 'preview.back' })).toBeDefined()
  expect(await texts(pane)).not.toContain('预览')
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
  await pane.press({ key: 'g1.u' })
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
