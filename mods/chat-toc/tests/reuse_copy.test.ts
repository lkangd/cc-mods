import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { PANE, appendRow, drawnButtons, host, mountPane, start, openOn } from './host'
import { transcript } from './fixture'
import { fillRefusedText, reusableOf } from '../hooks/reuse'
import { tocModel } from '../hooks/model'
import { setLanguage } from '../hooks/text'

/* CT-REUSE-001's automated half: Reuse and copy from the preview's label
   rows (spec §7). The worlds speak Chinese (host.ts). */

const CODE = 'CT-SYN fix this\n\n```ts\nconst a = 1\n```'

function two() {
  const t = transcript()
  t.prompt('CT-SYN first')
  t.reply([{ type: 'text', text: 'CT-SYN first answer' }])
  t.prompt(CODE)
  t.reply([{ type: 'text', text: '## CT-SYN done\n\n- `one`' }])
  return t
}

type Pane = Awaited<ReturnType<typeof mountPane>>
const keys = async (pane: Pane) => drawnButtons(await pane.drawn()).map(b => b.key)
const label = async (pane: Pane, key: string) => {
  const button = await pane.find({ type: 'Button', key })
  return button === undefined ? undefined : `${String(button.props.hotkey)}: ${button.text}`
}

/* The pane with the preview opened by a press on the newest group. */
async function opened($: Engine, bodyRows = 30) {
  const pane = await mountPane($, bodyRows)
  const users = (await keys(pane)).filter(k => typeof k === 'string' && /^g\d+\.u$/.test(k))
  await openOn(pane, String(users[users.length - 1]))
  return pane
}

test('the User label row carries r: 填入 · c: 复制, the Agent row a: 复制', async ($, on) => {
  await start($, host(on, two().jsonl()))
  const pane = await opened($)

  expect(await label(pane, 'preview.reuse')).toBe('r: 填入')
  expect(await label(pane, 'preview.copy.user')).toBe('c: 复制')
  expect(await label(pane, 'preview.copy.agent')).toBe('a: 复制')
  const drawn = await keys(pane)
  expect(drawn.indexOf('preview.reuse')).toBeLessThan(drawn.indexOf('preview.copy.user'))
  expect(drawn.indexOf('preview.copy.user')).toBeLessThan(drawn.indexOf('preview.copy.agent'))
})

test('r fills an empty composer with the User input as typed, replacing; never submits', async ($, on) => {
  const world = host(on, two().jsonl())
  await start($, world)
  const pane = await opened($)

  await pane.press({ key: 'preview.reuse' })
  expect(world.fills).toEqual([{ text: CODE, mode: 'replace' }])
  expect(world.toasts).toEqual([])
})

test('r with a draft in the composer appends after a blank line, the draft kept', async ($, on) => {
  const world = host(on, two().jsonl())
  await start($, world)
  const pane = await opened($)

  world.draft = 'CT-SYN my draft'
  await pane.press({ key: 'preview.reuse' })
  expect(world.draft).toBe(`CT-SYN my draft\n\n${CODE}`)
  expect(world.fills.map(f => f.mode)).toEqual(['append'])

  world.draft = 'CT-SYN line\n'
  await pane.press({ key: 'preview.reuse' })
  expect(world.draft).toBe(`CT-SYN line\n\n${CODE}`)
})

test('a slash command fills as /name args', async ($, on) => {
  const t = transcript()
  t.command('review', 'CT-SYN  the  branch')
  t.reply([{ type: 'text', text: 'CT-SYN reviewed' }])
  const world = host(on, t.jsonl())
  await start($, world)
  const pane = await opened($)

  await pane.press({ key: 'preview.reuse' })
  expect(world.fills.map(f => f.text)).toEqual(['/review CT-SYN  the  branch'])
})

test('a !cmd has no r; c copies !cmd as typed', async ($, on) => {
  const t = transcript()
  t.bash('echo CT-SYN')
  t.bashOutput('CT-SYN')
  const world = host(on, t.jsonl())
  await start($, world)
  const pane = await opened($)

  expect(await keys(pane)).not.toContain('preview.reuse')
  await pane.press({ key: 'preview.copy.user' })
  expect(world.copies).toEqual([{ text: '!echo CT-SYN', surface: 'terminal' }])
})

const IMAGE = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }

test('an image-only input has neither r nor c', async ($, on) => {
  const t = transcript()
  t.prompt('', { message: { role: 'user', content: [IMAGE] } })
  t.reply([{ type: 'text', text: 'CT-SYN a picture' }])
  await start($, host(on, t.jsonl()))
  const pane = await opened($)

  const drawn = await keys(pane)
  expect(drawn).not.toContain('preview.reuse')
  expect(drawn).not.toContain('preview.copy.user')
  expect(drawn).toContain('preview.copy.agent')
  const texts = (await pane.findAll({ type: 'Text' })).map(x => x.text)
  expect(texts).toContain('（只有图片）')
})

test('an image-only input read in one language offers neither r nor c in the other', () => {
  const t = transcript()
  t.prompt('', { message: { role: 'user', content: [IMAGE] } })
  setLanguage('zh')
  const group = tocModel(t.jsonl()).groups[0]!
  setLanguage('en')
  const offered = reusableOf(group, false)
  expect([offered.fill, offered.input, offered.hasImagesLeft]).toEqual([undefined, undefined, false])
  setLanguage('zh')
})

test('text with images fills and copies only the text, and a toast says the images were not included', async ($, on) => {
  const t = transcript()
  t.prompt('', { message: { role: 'user', content: [{ type: 'text', text: 'CT-SYN see [Image #1]' }, IMAGE] } })
  t.reply([{ type: 'text', text: 'CT-SYN seen' }])
  const world = host(on, t.jsonl())
  await start($, world)
  const pane = await opened($)

  await pane.press({ key: 'preview.reuse' })
  expect(world.fills.map(f => f.text)).toEqual(['CT-SYN see'])
  expect(world.toasts).toEqual(['图片未包含'])
  await pane.press({ key: 'preview.copy.user' })
  expect(world.copies.map(c => c.text)).toEqual(['CT-SYN see'])
  expect(world.toasts).toEqual(['图片未包含', '图片未包含'])
})

test('a running group has no a; r and c work', async ($, on) => {
  const t = transcript()
  t.prompt('CT-SYN earlier')
  t.reply([{ type: 'text', text: 'CT-SYN earlier answer' }])
  const world = host(on, t.jsonl())
  await start($, world)
  const pane = await mountPane($)

  await $.turn.start({ text: 'CT-SYN working', turnId: 'turn-1' })
  const asked = t.prompt('CT-SYN working')
  const first = t.reply([{ type: 'text', text: 'CT-SYN half' }, { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/home/synthetic/project/a.ts' } }])
  world.file = t.jsonl()
  await appendRow($, asked)
  await appendRow($, first)
  await world.clock.advance(300)
  await openOn(pane, 'g1.u')

  const drawn = await keys(pane)
  expect(drawn).toContain('preview.reuse')
  expect(drawn).toContain('preview.copy.user')
  expect(drawn).not.toContain('preview.copy.agent')
  await pane.press({ key: 'preview.reuse' })
  expect(world.fills.map(f => f.text)).toEqual(['CT-SYN working'])
})

test('c and a copy the whole text; the Button reads 已复制 for about 2 seconds', async ($, on) => {
  const world = host(on, two().jsonl())
  await start($, world)
  const pane = await opened($)

  await pane.press({ key: 'preview.copy.agent' })
  expect(world.copies.map(c => c.text)).toEqual(['## CT-SYN done\n\n- `one`'])
  expect(await label(pane, 'preview.copy.agent')).toBe('a: 已复制')
  expect(await label(pane, 'preview.copy.user')).toBe('c: 复制')
  await world.clock.advance(1_900)
  expect(await label(pane, 'preview.copy.agent')).toBe('a: 已复制')
  await world.clock.advance(200)
  expect(await label(pane, 'preview.copy.agent')).toBe('a: 复制')

  await pane.press({ key: 'preview.copy.user' })
  expect(world.copies.map(c => c.text)).toEqual(['## CT-SYN done\n\n- `one`', CODE])
  expect(await label(pane, 'preview.copy.user')).toBe('c: 已复制')
  expect(world.toasts).toEqual([])
})

test('a fill refused by another plugin says so in a toast, the draft kept', async ($, on) => {
  const world = host(on, two().jsonl())
  await start($, world)
  const pane = await opened($)

  world.draft = 'CT-SYN mine'
  world.refuseFill = 'hook'
  await pane.press({ key: 'preview.reuse' })
  expect(world.toasts).toEqual(['无法填入：被其他插件拒绝'])
  expect(world.draft).toBe('CT-SYN mine')
})

/* The kit strips a cause a hook writes, so the engine's own refusals are
   checked at the words they map to. */
test("each refused fill's toast: a dialog, no prompt box, a plugin's refusal", () => {
  setLanguage('zh')
  expect(fillRefusedText('dialog')).toBe('无法填入：有对话框打开')
  expect(fillRefusedText('no_composer')).toBe('无法填入：此处没有输入框')
  expect(fillRefusedText(undefined)).toBe('无法填入：被其他插件拒绝')
})

test('a copy that did not take says why in a toast, and the Button does not read 已复制', async ($, on) => {
  const world = host(on, two().jsonl())
  await start($, world)
  const pane = await opened($)

  world.refuseCopy = 'no-clipboard'
  await pane.press({ key: 'preview.copy.agent' })
  expect(world.toasts).toEqual(['太长，无法在此复制'])
  expect(await label(pane, 'preview.copy.agent')).toBe('a: 复制')
})

test('with the preview closed, before a press or after its ✕, none of the three Buttons is drawn', async ($, on) => {
  const world = host(on, two().jsonl())
  await start($, world)
  const pane = await mountPane($)
  const none = async () => {
    const drawn = await keys(pane)
    for (const key of ['preview.reuse', 'preview.copy.user', 'preview.copy.agent']) expect(drawn).not.toContain(key)
  }
  await none()

  await openOn(pane, 'g1.u')
  expect(await keys(pane)).toContain('preview.reuse')
  await pane.press({ key: 'preview' })
  await none()
})

test('a short preview that cuts the Agent label row takes a with it; expanded, a is back and c copies the whole input', async ($, on) => {
  const world = host(on, two().jsonl())
  await start($, world)
  const pane = await opened($, 17)

  const drawn = await keys(pane)
  expect(drawn).toContain('preview.more')
  expect(drawn).toContain('preview.copy.user')
  expect(drawn).not.toContain('preview.copy.agent')

  await pane.press({ key: 'preview.more' })
  expect(await label(pane, 'preview.reuse')).toBe('r: 填入')
  expect(await label(pane, 'preview.copy.agent')).toBe('a: 复制')
  await pane.press({ key: 'preview.copy.user' })
  expect(world.copies.map(c => c.text)).toEqual([CODE])
  expect(await label(pane, 'preview.copy.user')).toBe('c: 已复制')
})

test('expanded past the text cap, c and r take the whole input, not the part drawn', async ($, on) => {
  const t = transcript()
  const pasted = Array.from({ length: 4_000 }, (_, i) => `CT-SYN pasted line ${String(i).padStart(4, '0')} ${'x'.repeat(26)}`).join('\n')
  t.prompt(pasted)
  t.reply([{ type: 'text', text: 'CT-SYN read it' }])
  const world = host(on, t.jsonl())
  await start($, world)
  const pane = await opened($)

  await pane.press({ key: 'preview.more' })
  await pane.press({ key: 'preview.copy.user' })
  await pane.press({ key: 'preview.reuse' })
  expect(world.copies.map(c => c.text.length)).toEqual([pasted.length])
  expect(world.fills.map(f => f.text.length)).toEqual([pasted.length])
})

test('the ring moving from an entry onto the label-row Buttons keeps the preview on the group pressed, and r fills its input', async ($, on) => {
  const world = host(on, two().jsonl())
  await start($, world)
  const pane = await $.ui.mount({
    plugin: 'chat-toc',
    surface: 'terminal',
    component: 'Pane',
    requestId: PANE,
    viewport: { columns: 160, rows: 40, isFullscreen: true },
    props: { title: '目录', isFocused: true, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  })
  const arrow = (element: string) => $.ui.focus({ component: 'Pane', requestId: PANE, element, origin: { kind: 'person' } } as never)

  await arrow('g0.u')
  await openOn(pane, 'g0.u')
  await arrow('g1.u')
  await world.clock.advance(1)
  await arrow('preview.reuse')
  await world.clock.advance(1)
  expect((await pane.findAll({ type: 'Text' })).map(t => t.text)).toContain('CT-SYN first')
  await pane.press({ key: 'preview.reuse' })
  expect(world.fills.map(f => f.text)).toEqual(['CT-SYN first'])
})
