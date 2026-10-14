import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { PANE, host, mountPane, start } from './host'
import { transcript } from './fixture'

/* While the pane is off screen (chat-toc's own open waiting undrawn on a
   terminal too narrow for the host to seat it, or the pane closed), one
   line above the prompt names the plugin and counts the conversation, and
   a press on it opens the pane as the person's ask. */

const OPEN = { id: PANE, title: '目录', columns: 44 }
const BAND = 'chat-toc-open'

function three() {
  const t = transcript(new Date(2026, 9, 10, 9, 4).getTime())
  t.prompt('CT-SYN first')
  t.reply([{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }])
  t.toolResult('t1')
  t.reply([{ type: 'tool_use', id: 't2', name: 'Read', input: {} }])
  t.toolResult('t2')
  t.reply([{ type: 'text', text: 'CT-SYN first answer' }])
  t.prompt('CT-SYN second')
  return t
}

function mountBand($: Engine, hasSurvey = false) {
  return $.ui.mount({
    plugin: 'chat-toc',
    surface: 'terminal',
    component: 'AbovePrompt',
    requestId: 'above-prompt',
    viewport: { columns: 100, rows: 40, isFullscreen: true },
    props: { hasSurvey, isWorking: false, maxRows: 10, bodyColumns: 95, scroll: { offset: 0, bodyRows: 9 }, view: {} },
  } as never)
}

/* What Claude Code draws in the band beneath a plugin that passes. */
const ENGINE_BAND = () => ({ type: 'Text' as const, props: {}, children: ['drawn by Claude Code'] })

type Found = { key: string | undefined; text: string }

async function bandButtons(band: { findAll: (q: { type: string }) => Promise<Found[]> }) {
  return (await band.findAll({ type: 'Button' })).filter(b => b.key === BAND)
}

test('a pane waiting undrawn puts the counts above the prompt', async ($, on) => {
  const world = host(on, three().jsonl())
  on('ui.render', { component: 'AbovePrompt' }, ENGINE_BAND)
  world.unplaced = true
  await start($, world)

  const band = await mountBand($)
  await world.clock.settle()

  const texts = (await band.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts).toContain('☰ ChatTOC')
  expect(texts.join('')).toContain('用户 2 轮 · Agent 2 步')
  /* Only the open is a Button: the counts are not lit under the pointer. */
  expect((await bandButtons(band)).map(b => b.text)).toEqual(['展开目录 ❯'])
  expect(await band.findAll({ type: 'Button' })).toHaveLength(1)
})

test('a press on the band opens the pane as asked, and the band goes once it is drawn', async ($, on) => {
  const world = host(on, three().jsonl())
  on('ui.render', { component: 'AbovePrompt' }, ENGINE_BAND)
  world.unplaced = true
  await start($, world)
  const band = await mountBand($)
  await world.clock.settle()

  /* An asked open is seated at any width. */
  world.unplaced = false
  await band.press({ key: BAND })
  await world.clock.settle()
  expect(world.opens).toEqual([OPEN, { ...OPEN, focus: true }])

  await mountPane($, 12, 'inline')
  await world.clock.settle()
  expect(await bandButtons(band)).toEqual([])
})

test('a pane seated by itself shows no band', async ($, on) => {
  const world = host(on, three().jsonl())
  on('ui.render', { component: 'AbovePrompt' }, ENGINE_BAND)
  await start($, world)

  const band = await mountBand($)
  await world.clock.settle()

  expect(await bandButtons(band)).toEqual([])
})

test('a survey holds the band first', async ($, on) => {
  const world = host(on, three().jsonl())
  on('ui.render', { component: 'AbovePrompt' }, ENGINE_BAND)
  world.unplaced = true
  await start($, world)

  const band = await mountBand($, true)
  await world.clock.settle()

  expect(await bandButtons(band)).toEqual([])
})
