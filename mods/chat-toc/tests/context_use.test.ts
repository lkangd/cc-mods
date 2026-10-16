import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { appendRow, host, mountPane, start } from './host'
import type { Host } from './host'
import { transcript } from './fixture'
import { footerStatus } from '../hooks/pane'
import { setLanguage } from '../hooks/text'

/* CT-CTX-001 at the element tree: the context use in the footer and the
   band, read at the start and at every measure, hidden from a compaction
   until a measure brings a figure again; always dim. */

function three() {
  const t = transcript(new Date(2026, 9, 10, 9, 4).getTime())
  t.prompt('CT-SYN first')
  t.reply([{ type: 'text', text: 'CT-SYN first answer' }])
  t.prompt('CT-SYN second')
  t.reply([{ type: 'text', text: 'CT-SYN second answer' }])
  t.prompt('CT-SYN third')
  t.reply([{ type: 'text', text: 'CT-SYN third answer' }])
  return t
}

const measure = ($: Engine, percent: number | undefined) =>
  $.session.measure({
    context: { window: 1_000_000, ...(percent === undefined ? {} : { tokens: percent * 10_000, percent }) },
    rateLimits: [],
    changed: ['cost'],
  })

/* The footer's left: the count and what follows it. */
async function footer(pane: { findAll: (q: { type: string }) => Promise<{ text: string; props: Record<string, unknown> }[]> }) {
  return (await pane.findAll({ type: 'Text' })).find(t => /^\d+ 轮/.test(t.text))
}

test('before the first response there is no context use; a measure brings it, dim, whatever it says changed', async ($, on) => {
  const world = host(on, three().jsonl())
  await start($, world)
  const pane = await mountPane($)
  expect((await footer(pane))?.text).toBe('3 轮')

  await measure($, 62)
  await world.clock.settle()

  const shown = await footer(pane)
  expect(shown?.text).toBe('3 轮 · 上下文已用 62%')
  expect(shown?.props.dimColor).toBe(true)
})

test('the start reads the context use the host has, as after a hot reload', async ($, on) => {
  const world = host(on, three().jsonl())
  world.percent = 41
  await start($, world)
  const pane = await mountPane($)

  expect((await footer(pane))?.text).toBe('3 轮 · 上下文已用 41%')
})

const SUMMARY = [{ role: 'user' as const, text: 'CT-SYN summary', toolUses: [] }]

async function compacted($: Engine, world: Host, trigger: 'manual' | 'auto' = 'manual') {
  await $.session.compact({ trigger, messages: SUMMARY })
  await world.clock.settle()
}

test('a compaction hides it at once, a measure without a figure keeps it hidden, and one with a figure brings it back', async ($, on) => {
  const world = host(on, three().jsonl())
  world.percent = 62
  await start($, world)
  const pane = await mountPane($)

  await compacted($, world)
  expect((await footer(pane))?.text).toBe('3 轮')
  await measure($, undefined)
  await world.clock.settle()
  expect((await footer(pane))?.text).toBe('3 轮')
  await measure($, 3)
  await world.clock.settle()
  expect((await footer(pane))?.text).toBe('3 轮 · 上下文已用 3%')
})

test("a subagent's compaction, and one computed ahead, leave it be", async ($, on) => {
  const world = host(on, three().jsonl())
  world.percent = 62
  await start($, world)
  const pane = await mountPane($)

  await $.session.compact({ trigger: 'auto', agentId: 'agent-1', messages: SUMMARY })
  await $.session.compact({ trigger: 'precompute', messages: SUMMARY })
  await world.clock.settle()

  expect((await footer(pane))?.text).toBe('3 轮 · 上下文已用 62%')
})

test('a read that finds a new boundary no response has followed hides it until a measure', async ($, on) => {
  const t = three()
  const world = host(on, t.jsonl())
  world.percent = 62
  await start($, world)
  const pane = await mountPane($)

  t.compact('manual')
  t.command('compact', '', 'local')
  world.file = t.jsonl()
  await appendRow($, 'CT-SYN appended')
  await world.clock.advance(300)
  expect((await footer(pane))?.text).toBe('4 轮')

  await measure($, 2)
  await world.clock.settle()
  expect((await footer(pane))?.text).toBe('4 轮 · 上下文已用 2%')
})

test('a file read at the start whose last boundary was answered keeps the figure', async ($, on) => {
  const t = three()
  t.compact('auto')
  t.prompt('CT-SYN after')
  t.reply([{ type: 'text', text: 'CT-SYN after answer' }])
  const world = host(on, t.jsonl())
  world.percent = 9
  await start($, world)
  const pane = await mountPane($)

  expect((await footer(pane))?.text).toBe('4 轮 · 上下文已用 9%')
})

test('the band above the prompt adds the context use after its counts', async ($, on) => {
  const world = host(on, three().jsonl())
  world.unplaced = true
  world.percent = 62
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text' as const, props: {}, children: ['drawn by Claude Code'] }))
  await start($, world)
  const band = await $.ui.mount({
    plugin: 'chat-toc',
    surface: 'terminal',
    component: 'AbovePrompt',
    requestId: 'above-prompt',
    viewport: { columns: 100, rows: 40, isFullscreen: true },
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 95, scroll: { offset: 0, bodyRows: 9 }, view: {} },
  } as never)
  await world.clock.settle()

  const texts = (await band.findAll({ type: 'Text' })).map(x => x.text).join('')
  expect(texts).toContain('用户 3 轮 · Agent 0 步 · 上下文已用 62%')
  const part = (await band.findAll({ type: 'Text' })).find(x => x.text.includes('上下文'))
  expect(part?.props.dimColor).toBe(true)
})

test('the footer says the context use shorter, then leaves it out, as the width shrinks', () => {
  setLanguage('en')
  expect(footerStatus(38, 62, 44, 'card')).toBe('38 turns · context 62% used')
  expect(footerStatus(38, 62, 44, 'timeline')).toBe('38 turns · 62% used')
  expect(footerStatus(38, 62, 36, 'card')).toBe('38 turns · 62% used')
  expect(footerStatus(38, 62, 36, 'timeline')).toBe('38 turns')
  expect(footerStatus(38, undefined, 56, 'card')).toBe('38 turns')
  setLanguage('zh')
  expect(footerStatus(38, 62, 44, 'timeline')).toBe('38 轮 · 上下文已用 62%')
  expect(footerStatus(38, 62, 36, 'timeline')).toBe('38 轮 · 已用 62%')
  expect(footerStatus(38, 62, 30, 'timeline')).toBe('38 轮')
})
