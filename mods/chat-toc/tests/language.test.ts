import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { PANE, drawnButtons, entryTexts, host, isControlKey, mountPane, start } from './host'
import type { Host } from './host'
import { transcript } from './fixture'
import { languageOf } from '../hooks/text'

/* Ticket 37: the words follow the system's language, Chinese when the
   locale says Chinese and English otherwise, read from the POSIX locale
   variables at the session's start. */

test('the locale variables pick the language in POSIX order, Chinese only when the first one set says Chinese', () => {
  expect(languageOf({ LANG: 'zh_CN.UTF-8' })).toBe('zh')
  expect(languageOf({ LANG: 'zh_TW.UTF-8' })).toBe('zh')
  expect(languageOf({ LANG: 'zh-Hans' })).toBe('zh')
  expect(languageOf({ LANG: 'zh' })).toBe('zh')
  expect(languageOf({ LANG: 'en_US.UTF-8' })).toBe('en')
  expect(languageOf({ LANG: 'C' })).toBe('en')
  expect(languageOf({})).toBe('en')
  expect(languageOf({ LC_ALL: 'en_US.UTF-8', LANG: 'zh_CN.UTF-8' })).toBe('en')
  expect(languageOf({ LC_MESSAGES: 'zh_CN.UTF-8', LANG: 'en_US.UTF-8' })).toBe('zh')
  expect(languageOf({ LC_ALL: '', LANG: 'zh_CN.UTF-8' })).toBe('zh')
})

function three() {
  const t = transcript(new Date(2026, 9, 10, 9, 4).getTime())
  t.prompt('CT-SYN first')
  t.reply([{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }])
  t.toolResult('t1')
  t.reply([{ type: 'text', text: 'CT-SYN first answer' }])
  t.prompt('CT-SYN second')
  return t
}

async function english($: Engine, on: Parameters<typeof host>[0], env: Record<string, string>): Promise<Host> {
  const world = host(on, three().jsonl())
  world.env = env
  await start($, world)
  return world
}

test('an English locale opens the pane titled in English', async ($, on) => {
  const world = await english($, on, { LANG: 'en_US.UTF-8' })

  expect(world.opens).toEqual([{ id: PANE, title: 'Contents', columns: 44 }])
})

test('no locale at all is English', async ($, on) => {
  const world = await english($, on, {})

  expect(world.opens).toEqual([{ id: PANE, title: 'Contents', columns: 44 }])
})

test('in English the filters, the Layout Button, the steps, the day and the count read in English', async ($, on) => {
  await english($, on, { LANG: 'en_US.UTF-8' })
  const pane = await mountPane($)

  const controls = drawnButtons(await pane.drawn()).filter(b => isControlKey(b.key))
  expect(controls.map(b => b.label)).toEqual(['All', 'User', 'Agent', 'Find', '‹', '›', 'Layout: Card'])
  expect(await entryTexts(pane)).toContain('1 step · CT-SYN first answer')
  const texts = (await pane.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts.some(t => t.includes('Today · Oct 10'))).toBe(true)
  expect(texts).toContain('2 turns')

  /* A press opens the preview under its English rule. */
  await pane.press({ key: 'g1.u' })
  expect((await pane.findAll({ type: 'Text' })).map(t => t.text)).toContain('Preview')
})

test('a Chinese locale under LC_ALL wins over an English LANG', async ($, on) => {
  const world = await english($, on, { LC_ALL: 'zh_CN.UTF-8', LANG: 'en_US.UTF-8' })

  expect(world.opens).toEqual([{ id: PANE, title: '目录', columns: 44 }])
})

test('on the desktop the filters and the strip read in English', async ($, on) => {
  await english($, on, { LANG: 'en_US.UTF-8' })
  const pane = await $.ui.mount({
    plugin: 'chat-toc',
    surface: 'desktop',
    component: 'Pane',
    requestId: PANE,
    props: { title: 'Contents', isFocused: false, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  } as never)

  const svgs: { alt: string; source: string }[] = []
  const walk = (node: unknown) => {
    if (typeof node !== 'object' || node === null) return
    const el = node as { type?: string; props?: Record<string, unknown>; children?: unknown[] }
    if (el.type === 'Svg') svgs.push({ alt: String(el.props?.alt), source: String(el.props?.source) })
    for (const child of el.children ?? []) walk(child)
  }
  walk(await pane.drawn())
  expect(svgs.some(s => s.alt === 'Filter: All')).toBe(true)
  expect(svgs.some(s => s.alt === 'Rail')).toBe(true)
  const strip = svgs.find(s => s.alt.startsWith('2 turns'))
  expect(strip?.alt).toBe('2 turns, one bar per turn, height by steps')
  expect(strip?.source).toContain('>Oct 10 09:05<')
})
