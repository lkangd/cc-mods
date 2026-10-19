import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { PANE, drawnButtons, host, mountPane, start } from './host'
import { transcript } from './fixture'
import { bandFit } from '../hooks/band'
import { setLanguage, text as words } from '../hooks/text'

/* While the pane is off screen (chat-toc's own open waiting undrawn on a
   terminal too narrow for the host to seat it, or the pane closed), one
   line above the prompt names the plugin and counts the conversation, and
   a press on it opens the pane as the person's ask. */

const OPEN = { id: PANE, title: 'ChatTOC', columns: 44 }
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

function mountBand($: Engine, hasSurvey = false, surface: 'terminal' | 'desktop' = 'terminal', bodyColumns = 95) {
  return $.ui.mount({
    plugin: 'chat-toc',
    surface,
    component: 'AbovePrompt',
    requestId: 'above-prompt',
    viewport: { columns: 100, rows: 40, isFullscreen: true },
    props: { hasSurvey, isWorking: false, maxRows: 10, bodyColumns, scroll: { offset: 0, bodyRows: 9 }, view: {} },
  } as never)
}

const DISMISS = 'chat-toc-band.dismiss'

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
  expect(texts.join('')).toContain('用户 2 轮 · Agent 2 步')
  /* Only the name, ‹ ›, the open and the ✕ are Buttons: the counts are not lit under the pointer. */
  expect((await bandButtons(band)).map(b => b.text)).toEqual(['展开目录 ❯'])
  expect((await band.findAll({ type: 'Button' })).map(b => b.key)).toEqual(['chat-toc-band.name', 'chat-toc-band.previous', 'chat-toc-band.next', BAND, DISMISS])
  expect((await band.find({ type: 'Button', key: 'chat-toc-band.name' }))?.text).toBe('ChatTOC')
})

test('the band carries ‹ › with the borrowed actions, as the pane does', async ($, on) => {
  const world = host(on, three().jsonl())
  on('ui.render', { component: 'AbovePrompt' }, ENGINE_BAND)
  world.unplaced = true
  await start($, world)
  const band = await mountBand($)
  await world.clock.settle()

  const previous = await band.find({ type: 'Button', key: 'chat-toc-band.previous' })
  const next = await band.find({ type: 'Button', key: 'chat-toc-band.next' })
  expect([previous?.text, previous?.props.plain, previous?.props.action]).toEqual(['‹', true, 'app:toggleDiffNoiseFilter'])
  expect([next?.text, next?.props.plain, next?.props.action]).toEqual(['›', true, 'app:toggleDiffPreSession'])
})

test('the band draws while the pane is a tab behind another, and goes when it is in front again', async ($, on) => {
  const world = host(on, three().jsonl())
  on('ui.render', { component: 'AbovePrompt' }, ENGINE_BAND)
  await start($, world)
  const band = await mountBand($)
  await world.clock.settle()
  expect(await bandButtons(band)).toEqual([])

  world.panes = world.panes.map(p => ({ ...p, isShown: false }))
  await band.redraw({ hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 95, scroll: { offset: 0, bodyRows: 9 }, view: {} } as never)
  expect((await bandButtons(band)).map(b => b.text)).toEqual(['展开目录 ❯'])

  /* The pane drawn in front again asks the band to go. */
  world.panes = world.panes.map(p => ({ ...p, isShown: true }))
  await mountPane($)
  await world.clock.settle()
  expect(await bandButtons(band)).toEqual([])
})

test("the open Button's words are its label, which 2.1.287 takes alone, lit in the accent under the pointer", async ($, on) => {
  const world = host(on, three().jsonl())
  on('ui.render', { component: 'AbovePrompt' }, ENGINE_BAND)
  world.unplaced = true
  await start($, world)
  const band = await mountBand($)
  await world.clock.settle()

  const open = drawnButtons(await band.drawn()).find(b => b.key === BAND)
  expect([open?.label, open?.hover]).toEqual(['展开目录 ❯', { scope: BAND, color: 'suggestion' }])
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

test('the band opens no preview: neither its ‹ › nor its open', async ($, on) => {
  const world = host(on, three().jsonl())
  on('ui.render', { component: 'AbovePrompt' }, ENGINE_BAND)
  world.unplaced = true
  await start($, world)
  const band = await mountBand($)
  await world.clock.settle()

  await band.press({ key: 'chat-toc-band.previous' })
  await world.clock.settle()
  world.unplaced = false
  await band.press({ key: BAND })
  await world.clock.settle()
  const pane = await mountPane($)
  await world.clock.settle()
  expect(await pane.find({ type: 'Button', key: 'preview' })).toBeUndefined()
  expect(await pane.find({ type: 'Markdown' })).toBeUndefined()
})

test('the desktop band draws no ‹ ›, and its name is the label alone on any host', async ($, on) => {
  const world = host(on, three().jsonl())
  on('ui.render', { component: 'AbovePrompt' }, ENGINE_BAND)
  world.unplaced = true
  await start($, world)
  const band = await mountBand($, false, 'desktop')
  await world.clock.settle()

  /* The name opens the pane on every host: the app draws a Button's label in
     its own colour, so it is the label alone. */
  expect((await band.findAll({ type: 'Button' })).map(b => b.key)).toEqual(['chat-toc-band.name', BAND, DISMISS])
  expect((await band.find({ type: 'Button', key: 'chat-toc-band.name' }))?.text).toBe('ChatTOC')
  expect((await band.findAll({ type: 'Text' })).map(t => t.text).join('')).toContain('用户 2 轮 · Agent 2 步')
})

test('a narrow band leaves out the counts tail first, then the name, never wrapping', () => {
  setLanguage('en')
  const counts = { turns: 48, steps: 752, percent: 49 }
  const line = (columns: number, surface: 'terminal' | 'desktop' = 'desktop') => {
    const fit = bandFit(counts, columns, surface)
    return [fit.hasTitle ? 'title' : '', fit.counts.map(p => p.text).join('')].join('|')
  }
  expect(line(87)).toBe('title|48 user turns · 752 agent steps · context 49% used')
  expect(line(86)).toBe('title|48 user turns · 752 agent steps · 49% used')
  expect(line(78)).toBe('title|48 user turns · 752 agent steps')
  expect(line(67)).toBe('title|48 user turns')
  expect(line(49)).toBe('title|')
  expect(line(31)).toBe('|')
  /* The terminal's ‹ › take room too, and it keeps no slack. */
  expect(line(69, 'terminal')).toBe('title|48 user turns · 752 agent steps')
  expect(line(68, 'terminal')).toBe('title|48 user turns')
  /* Past the name, the terminal keeps ‹ › while they fit. */
  expect(bandFit(counts, 32, 'terminal')).toMatchObject({ hasTitle: false, hasWalk: true })
  expect(bandFit(counts, 20, 'terminal')).toMatchObject({ hasTitle: false, hasWalk: false })
  expect(words.bandOpen).toBe('Open contents ❯')
  setLanguage('zh')
})

test("the band's ✕ hides it, says how to bring it back, and keeps it hidden across sessions", async ($, on) => {
  const world = host(on, three().jsonl())
  on('ui.render', { component: 'AbovePrompt' }, ENGINE_BAND)
  world.unplaced = true
  await start($, world)
  const band = await mountBand($)
  await world.clock.settle()

  await band.press({ key: DISMISS })
  await world.clock.settle()
  expect(await band.findAll({ type: 'Button' })).toEqual([])
  expect(world.store.isBandHidden).toBe(true)
  expect(world.toasts).toEqual(['已隐藏 ChatTOC 栏，/chat-toc-band 可重新显示'])

  /* A later session reads it back. */
  await $.session.start({ cwd: '/home/synthetic/project', surface: 'terminal', isInteractive: true })
  await world.clock.settle()
  await band.redraw({ hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 95, scroll: { offset: 0, bodyRows: 9 }, view: {} } as never)
  expect(await band.findAll({ type: 'Button' })).toEqual([])
})

test('/chat-toc-band shows the hidden band again', async ($, on) => {
  const world = host(on, three().jsonl(), undefined, { isBandHidden: true })
  on('ui.render', { component: 'AbovePrompt' }, ENGINE_BAND)
  world.unplaced = true
  await start($, world)
  const band = await mountBand($)
  await world.clock.settle()
  expect(await band.findAll({ type: 'Button' })).toEqual([])

  await $.command.run({ command: 'chat-toc-band', args: '' } as never)
  await world.clock.settle()
  expect((await bandButtons(band)).map(b => b.text)).toEqual(['展开目录 ❯'])
  expect(world.store.isBandHidden).toBe(false)
})

test('from 2.1.303 the terminal draws the name in the accent, and a press on it opens the pane', async ($, on) => {
  const world = host(on, three().jsonl())
  on('session.version', () => ({ value: { version: '2.1.303', base: '2.1.303' } }))
  on('ui.render', { component: 'AbovePrompt' }, ENGINE_BAND)
  world.unplaced = true
  await start($, world)
  const band = await mountBand($)
  await world.clock.settle()

  const name = await band.find({ type: 'Button', key: 'chat-toc-band.name' })
  expect(name?.text).toBe('ChatTOC')
  expect(await band.find({ type: 'Text', text: 'ChatTOC' })).toMatchObject({ props: { color: 'claude', bold: true } })

  world.unplaced = false
  await band.press({ key: 'chat-toc-band.name' })
  await world.clock.settle()
  expect(world.opens).toEqual([OPEN, { ...OPEN, focus: true }])
})

test('before 2.1.303, which takes a Button label alone, the name is a label-only Button that opens the pane', async ($, on) => {
  const world = host(on, three().jsonl())
  on('session.version', () => ({ value: { version: '2.1.295', base: '2.1.295' } }))
  on('ui.render', { component: 'AbovePrompt' }, ENGINE_BAND)
  world.unplaced = true
  await start($, world)
  const band = await mountBand($)
  await world.clock.settle()

  const name = drawnButtons(await band.drawn()).find(b => b.key === 'chat-toc-band.name')
  expect(name?.label).toBe('ChatTOC')
  expect(await band.find({ type: 'Text', text: 'ChatTOC' })).toBeUndefined()

  world.unplaced = false
  await band.press({ key: 'chat-toc-band.name' })
  await world.clock.settle()
  expect(world.opens).toEqual([OPEN, { ...OPEN, focus: true }])
})
