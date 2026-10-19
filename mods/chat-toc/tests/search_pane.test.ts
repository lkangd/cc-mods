import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { PANE, appendRow, drawnButtons, entryTexts, host, isBarKey, mountPane, start, openOn } from './host'
import type { Host } from './host'
import { transcript } from './fixture'
import type { Builder } from './fixture'

/* CT-FIND-001/002's automated half: the search row under the tab rule, the
   list narrowed to the matches, the keys that end or keep a search (spec
   §1, §2, §3). The worlds speak Chinese (host.ts) unless a test says not. */

type Pane = Awaited<ReturnType<typeof mountPane>>

const use = (id: string, name: string, input: Record<string, unknown>) => ({ type: 'tool_use', id, name, input })

function turn(t: Builder, prompt: string, answer: string) {
  t.prompt(prompt)
  t.reply([{ type: 'text', text: answer }])
}

function session(): Builder {
  const t = transcript()
  turn(t, 'CT-SYN fix the login page', 'CT-SYN the login form validates')
  turn(t, 'CT-SYN write the readme', 'CT-SYN done')
  t.prompt('CT-SYN restyle it')
  t.reply([use('t1', 'Edit', { file_path: '/home/synthetic/project/src/LoginPage.tsx', old_string: 'a', new_string: 'b' })])
  t.toolResult('t1')
  t.reply([{ type: 'text', text: 'CT-SYN restyled' }])
  return t
}

const type = ($: Engine, text: string) => $.ui.input({ plugin: 'chat-toc', key: 'search', text, kind: 'change' })
const enter = ($: Engine, text: string) => $.ui.input({ plugin: 'chat-toc', key: 'search', text })
const texts = async (pane: Pane) => (await pane.findAll({ type: 'Text' })).map(t => t.text.trim())
const field = (pane: Pane) => pane.find({ type: 'Input', key: 'search' })

async function opened(on: Parameters<typeof host>[0], $: Engine, t = session(), rows = 40): Promise<{ world: Host; pane: Pane }> {
  const world = host(on, t.jsonl())
  await start($, world)
  return { world, pane: await mountPane($, rows) }
}

test('the search row sits under the tab rule: the f Button and the field, no count and no ✕ without a query', async ($, on) => {
  const { pane } = await opened(on, $)
  const keys = drawnButtons(await pane.drawn()).map(b => b.key)
  expect(keys.slice(0, 4)).toEqual(['f-all', 'f-user', 'f-agent', 'search.focus'])
  expect(keys).not.toContain('search.clear')
  const find = await pane.find({ type: 'Button', key: 'search.focus' })
  expect([find?.text, find?.props.hotkey, find?.props.plain]).toEqual(['搜索', 'f', true])
  const input = await field(pane)
  expect(input?.props.placeholder).toBe('词或文件路径')
  expect(input?.props.submitLabel).toBe('跳转')
  expect(input?.props.value).toBe('')
  expect(input?.props.autoFocus).toBeUndefined()
})

test('a query narrows the list to the groups holding every word, with the count and ✕', async ($, on) => {
  const { pane, world } = await opened(on, $)
  await type($, 'LOGIN')
  await world.clock.settle()
  expect((await field(pane))?.props.value).toBe('LOGIN')
  const shown = await entryTexts(pane)
  expect(shown.some(s => s.includes('fix the login page'))).toBe(true)
  expect(shown.some(s => s.includes('restyle it'))).toBe(true)
  expect(shown.some(s => s.includes('write the readme'))).toBe(false)
  expect(await texts(pane)).toContain('2 / 3')
  expect(drawnButtons(await pane.drawn()).map(b => b.key)).toContain('search.clear')
  expect(world.store).not.toHaveProperty('query')
  expect(JSON.stringify(world.store)).not.toContain('LOGIN')
})

test('no match says so, and the footer still counts every group', async ($, on) => {
  const { pane, world } = await opened(on, $)
  await type($, 'CT-SYN nowhere')
  await world.clock.settle()
  expect(await entryTexts(pane)).toEqual([])
  const shown = await texts(pane)
  expect(shown).toContain('没有匹配的轮次')
  expect(shown).toContain('0 / 3')
})

test('the words are English under an English locale', async ($, on) => {
  const world = host(on, session().jsonl())
  world.env = { LANG: 'en_US.UTF-8' }
  await start($, world)
  const pane = await mountPane($, 40)
  expect((await pane.find({ type: 'Button', key: 'search.focus' }))?.text).toBe('Find')
  expect((await field(pane))?.props.placeholder).toBe('words or a file path')
  expect((await field(pane))?.props.submitLabel).toBe('jump')
  await type($, 'login')
  await world.clock.settle()
  expect(await texts(pane)).toContain('2 of 3')
  await type($, 'nowhere')
  await world.clock.settle()
  expect(await texts(pane)).toContain('No turns match')
})

test('the View filter picks the fields: User only the input, Agent only the last text and paths', async ($, on) => {
  const { pane, world } = await opened(on, $)
  await type($, 'validates')
  await world.clock.settle()
  expect((await entryTexts(pane)).length).toBeGreaterThan(0)
  await pane.press({ key: 'f-user' })
  await world.clock.settle()
  expect(await entryTexts(pane)).toEqual([])
  expect((await field(pane))?.props.value).toBe('validates')
  await pane.press({ key: 'f-agent' })
  await type($, 'loginpage')
  await world.clock.settle()
  const shown = await entryTexts(pane)
  expect(shown.length).toBe(1)
  expect(shown[0]).toContain('restyled')
})

test('a new turn that matches joins the list', async ($, on) => {
  const t = session()
  const { pane, world } = await opened(on, $, t)
  await type($, 'readme')
  await world.clock.settle()
  expect((await entryTexts(pane)).filter(s => s.includes('readme')).length).toBe(1)
  turn(t, 'CT-SYN read the README again', 'CT-SYN ok')
  world.file = t.jsonl()
  await appendRow($, 'u-new')
  await world.clock.advance(300)
  expect((await entryTexts(pane)).filter(s => s.includes('again')).length).toBe(1)
  expect(await texts(pane)).toContain('2 / 4')
})

test('compaction rules stay between the groups shown', async ($, on) => {
  const t = transcript()
  turn(t, 'CT-SYN alpha one', 'CT-SYN a')
  turn(t, 'CT-SYN beta', 'CT-SYN b')
  t.compact('auto')
  turn(t, 'CT-SYN gamma', 'CT-SYN c')
  turn(t, 'CT-SYN alpha two', 'CT-SYN d')
  const { pane, world } = await opened(on, $, t)
  await type($, 'alpha')
  await world.clock.settle()
  const boxes = (await pane.findAll({ type: 'Box' })).filter(b => b.key?.startsWith('compaction-'))
  expect(boxes.length).toBe(1)
  expect(boxes[0]?.key).toBe('compaction-g3.u')
})

test('the Minimap lights the matches, and none with no match', async ($, on) => {
  const { pane, world } = await opened(on, $)
  const lit = async () =>
    drawnButtons(await pane.drawn())
      .filter(b => isBarKey(b.key) && b.dimColor !== true)
      .map(b => b.key)
  await type($, 'login')
  await world.clock.settle()
  expect(await lit()).toEqual(['m.0', 'm.2'])
  await type($, 'nowhere')
  await world.clock.settle()
  expect(await lit()).toEqual([])
})

test('✕ clears the query and the list is whole again; emptying the field does too', async ($, on) => {
  const { pane, world } = await opened(on, $)
  await type($, 'readme')
  await world.clock.settle()
  await pane.press({ key: 'search.clear' })
  await world.clock.settle()
  expect((await field(pane))?.props.value).toBe('')
  expect((await entryTexts(pane)).some(s => s.includes('login'))).toBe(true)
  await type($, 'readme')
  await type($, '')
  await world.clock.settle()
  expect((await entryTexts(pane)).some(s => s.includes('login'))).toBe(true)
  expect(drawnButtons(await pane.drawn()).map(b => b.key)).not.toContain('search.clear')
})

test('Enter jumps to the nearest match and ends the search; with no match it only clears', async ($, on) => {
  const { pane, world } = await opened(on, $)
  await type($, 'readme')
  await enter($, 'readme')
  await world.clock.settle()
  expect((await field(pane))?.props.value).toBe('')
  expect((await entryTexts(pane)).some(s => s.includes('login'))).toBe(true)

  await type($, 'nowhere')
  await enter($, 'nowhere')
  await world.clock.settle()
  expect((await field(pane))?.props.value).toBe('')
})

test('the query survives a filter switch, a Layout switch and the pane drawn again', async ($, on) => {
  const { pane, world } = await opened(on, $)
  await type($, 'login')
  await pane.press({ key: 'f-user' })
  await pane.press({ key: 'layout' })
  await world.clock.settle()
  expect((await field(pane))?.props.value).toBe('login')
  await pane.redraw({ title: '目录', isFocused: false, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} })
  expect((await field(pane))?.props.value).toBe('login')
})

test('Enter in the field opens no preview: it selects the match it jumps to, whose row opens it', async ($, on) => {
  const { pane, world } = await opened(on, $)
  await type($, 'nowhere')
  await enter($, 'nowhere')
  await world.clock.settle()
  expect(await pane.find({ type: 'Button', key: 'preview' })).toBeUndefined()

  await type($, 'readme')
  await enter($, 'readme')
  await world.clock.settle()
  expect(await pane.find({ type: 'Button', key: 'preview' })).toBeUndefined()
  const open = (await pane.findAll({ type: 'Button' })).find(b => String(b.key).endsWith(':preview'))
  expect(open).toBeDefined()
  await pane.press({ key: String(open!.key) })
  expect(await texts(pane)).toContain('CT-SYN write the readme')
})

test('Enter on an entry during a search keeps the search and opens the preview: its meta line says what matched, a matching path first', async ($, on) => {
  const t = session()
  t.prompt('CT-SYN unrelated')
  t.reply([use('t9', 'Read', { file_path: '/home/synthetic/project/z.ts' })])
  t.toolResult('t9')
  const { pane, world } = await opened(on, $, t)
  await type($, 'login')
  await world.clock.settle()
  expect(await pane.find({ type: 'Button', key: 'preview' })).toBeUndefined()

  await openOn(pane, 'g2.u')
  expect((await field(pane))?.props.value).toBe('login')
  const shown = await texts(pane)
  expect(shown).toContain('CT-SYN restyle it')
  expect(shown.some(s => /匹配：文件$/.test(s))).toBe(true)
  expect(shown).toContain('改 src/LoginPage.tsx')

  /* A query that leaves the group out of the list leaves the preview on it. */
  await type($, 'login validates')
  await world.clock.settle()
  expect(await entryTexts(pane)).not.toContain('CT-SYN restyle it')
  const held = await texts(pane)
  expect(held).toContain('CT-SYN restyle it')
  expect(held.some(s => s.includes('匹配'))).toBe(false)

  await openOn(pane, 'g0.u')
  const first = await texts(pane)
  expect(first).toContain('CT-SYN fix the login page')
  expect(first.some(s => /匹配：用户 · Agent$/.test(s))).toBe(true)
})

test('a matching read path is named on the files line', async ($, on) => {
  const t = transcript()
  t.prompt('CT-SYN look')
  t.reply([use('t1', 'Read', { file_path: '/home/synthetic/project/a.ts' }), use('t2', 'Read', { file_path: '/home/synthetic/project/needle.ts' })])
  t.toolResult('t1')
  t.toolResult('t2')
  t.reply([{ type: 'text', text: 'CT-SYN seen' }])
  const { pane, world } = await opened(on, $, t)
  await openOn(pane, 'g0.u')
  expect(await texts(pane)).toContain('读 2')
  await type($, 'needle')
  await world.clock.settle()
  expect(await texts(pane)).toContain('读 needle.ts +1')
})

test('the focus ring: up from the first entry lands on the search row, not the filter row', async ($, on) => {
  const world = host(on, session().jsonl())
  await start($, world)
  const pane = await $.ui.mount({
    plugin: 'chat-toc',
    surface: 'terminal',
    component: 'Pane',
    requestId: PANE,
    viewport: { columns: 160, rows: 40, isFullscreen: true },
    props: { title: '目录', isFocused: true, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  await world.clock.settle()
  const arrow = (element: string) => $.ui.focus({ component: 'Pane', requestId: PANE, element, origin: { kind: 'person' } } as never)
  await arrow('g0.u')
  world.focuses.length = 0
  await arrow('m.0')
  expect(world.focuses.at(-1)?.element).toBe('search')
  await type($, 'login')
  await world.clock.settle()
  await arrow('g0.u')
  await arrow('m.0')
  expect(world.focuses.at(-1)?.element).toBe('search.clear')
  void pane
})
