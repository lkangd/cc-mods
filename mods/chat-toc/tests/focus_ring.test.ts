import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { pendingShown, ringMove } from '../hooks/ring'
import { topRevealing, windowOf } from '../hooks/window'
import { PANE, entryTexts, host, mountPane, start } from './host'
import { transcript } from './fixture'

/* CT-UI-003: with the pane focused the arrows walk the host's focus ring,
   which chat-toc keeps on entries' first lines, dim ones included, scrolling
   its window at either end; Enter presses as a click does. */

const KEYS = ['g0.u', 'g0.a', 'g1.u', 'g2.u', 'g2.a']
const INDEX = new Map(KEYS.map((key, i) => [key, i]))
/* Entries 1 to 3 are in view. */
const WINDOW = { start: 1, end: 4, maxStart: 2 }
const move = (from: string | undefined, to: string | undefined) => ringMove(KEYS, INDEX, WINDOW, from, to)

/* The ring runs the filter Buttons, the entries in the window, then the
   footer's Layout Button, and wraps. */
test("a step onto an entry's first line, or onto a control, lands where the host puts it", () => {
  expect(move('g1.u', 'g2.u')).toEqual({ kind: 'accept' })
  expect(move(undefined, 'g0.a')).toEqual({ kind: 'accept' })
  expect(move('f-agent', 'g0.a')).toEqual({ kind: 'accept' })
  expect(move('f-all', 'f-user')).toEqual({ kind: 'accept' })
})

test("down off an entry's first line goes to the next entry, not the entry's second line", () => {
  expect(move('g0.a', 'g0.a.1')).toEqual({ kind: 'land', key: 'g1.u' })
  expect(move('g1.u', 'g1.u.1')).toEqual({ kind: 'land', key: 'g2.u' })
})

test("up onto an entry's last line lands on its first", () => {
  expect(move('g2.u', 'g1.u.2')).toEqual({ kind: 'land', key: 'g1.u' })
  /* Up from the footer's Layout Button onto the last entry's last line. */
  expect(move('layout', 'g2.u.1')).toEqual({ kind: 'land', key: 'g2.u' })
})

test('past the bottom of the window the next entry is brought into view', () => {
  /* A multi-line entry: down goes to its second line. */
  expect(move('g2.u', 'g2.u.1')).toEqual({ kind: 'reveal', index: 4 })
  /* A one-line entry: the host goes on to the footer's Layout Button. */
  expect(move('g2.u', 'layout')).toEqual({ kind: 'reveal', index: 4 })
})

test('past the top of the window the entry before is brought into view', () => {
  expect(move('g0.a', 'f-agent')).toEqual({ kind: 'reveal', index: 0 })
})

test('at either end of the list the host wraps as it does', () => {
  const all = { start: 0, end: 5, maxStart: 0 }
  expect(ringMove(KEYS, INDEX, all, 'g2.a', 'layout')).toEqual({ kind: 'accept' })
  expect(ringMove(KEYS, INDEX, all, 'g2.a', 'g2.a.1')).toEqual({ kind: 'land', key: 'layout' })
  expect(ringMove(KEYS, INDEX, all, 'g0.u', 'f-agent')).toEqual({ kind: 'accept' })
})

test('the Minimap\'s cells are stepped over: down from the filter row to the first entry in view, up from an entry to the filter row', () => {
  expect(move('f-agent', 'm.0')).toEqual({ kind: 'land', key: 'g0.a' })
  expect(move(undefined, 'm.3')).toEqual({ kind: 'land', key: 'g0.a' })
  /* Up from the window's first entry, with entries above it: bring one in. */
  expect(move('g0.a', 'm.3')).toEqual({ kind: 'reveal', index: 0 })
  const all = { start: 0, end: 5, maxStart: 0 }
  expect(ringMove(KEYS, INDEX, all, 'g0.u', 'm.3')).toEqual({ kind: 'land', key: 'f-agent' })
  /* No entries: up from the Layout Button goes to the filter row. */
  expect(ringMove([], new Map(), { start: 0, end: 0, maxStart: 0 }, 'layout', 'm.3')).toEqual({ kind: 'land', key: 'f-agent' })
  /* No entries: down from the filter row goes to the footer. */
  expect(ringMove([], new Map(), { start: 0, end: 0, maxStart: 0 }, 'f-agent', 'm.0')).toEqual({ kind: 'land', key: 'layout' })
})

test("with the preview drawn, its Buttons come between the entries and the footer, and the ring treats them as it treats the footer", () => {
  const after = (from: string | undefined, to: string | undefined, window = WINDOW) => ringMove(KEYS, INDEX, window, from, to, 'preview')
  /* Down off the window's last entry onto the preview's rule: the next entry instead. */
  expect(after('g2.u', 'preview')).toEqual({ kind: 'reveal', index: 4 })
  const all = { start: 0, end: 5, maxStart: 0 }
  /* Down off the list's last entry's first line: the preview's rule. */
  expect(after('g2.a', 'g2.a.1', all)).toEqual({ kind: 'land', key: 'preview' })
  expect(after('g2.a', 'preview', all)).toEqual({ kind: 'accept' })
  /* Up from the cut line or the rule onto the last entry. */
  expect(after('preview', 'g2.a.1', all)).toEqual({ kind: 'land', key: 'g2.a' })
  /* No entries: down from the filter row to the preview, up from it to the filter row. */
  expect(ringMove([], new Map(), { start: 0, end: 0, maxStart: 0 }, 'f-agent', 'm.0', 'preview')).toEqual({ kind: 'land', key: 'preview' })
  expect(ringMove([], new Map(), { start: 0, end: 0, maxStart: 0 }, 'preview.more', 'm.3', 'preview')).toEqual({ kind: 'land', key: 'f-agent' })
})

test('a ring move waiting for its entry is sent by the drawing whose window shows it', () => {
  /* Entries 1 to 3 are in view. */
  expect(pendingShown('g2.u', INDEX, WINDOW)).toBe('g2.u')
  expect(pendingShown('g1.u', INDEX, WINDOW)).toBe('g1.u')
  /* Not yet in this drawing's window: it waits for the next one. */
  expect(pendingShown('g2.a', INDEX, WINDOW)).toBeUndefined()
  expect(pendingShown('g0.u', INDEX, WINDOW)).toBeUndefined()
  /* Gone from the entries (filtered out), or none waiting. */
  expect(pendingShown('g9.u', INDEX, WINDOW)).toBeUndefined()
  expect(pendingShown(undefined, INDEX, WINDOW)).toBeUndefined()
})

test('bringing an entry into view moves the window as little as it takes', () => {
  const heights = [3, 3, 3, 3, 3]
  const at = windowOf(heights, 9, 1)
  expect(at).toEqual({ start: 1, end: 4, maxStart: 2 })
  expect(topRevealing(heights, 9, at, 2)).toBe(1)
  expect(topRevealing(heights, 9, at, 0)).toBe(0)
  /* The last entry shows from the window that ends with it: following. */
  expect(topRevealing(heights, 9, at, 4)).toBeUndefined()
  const top = { start: 0, end: 3, maxStart: 2 }
  expect(topRevealing([3, 3, 3, 3, 3, 3], 9, { ...top, maxStart: 3 }, 3)).toBe(1)
})

/* The person's arrows moving the pane's focus ring onto one Button. */
function arrow($: Engine, element: string) {
  return $.ui.focus({ component: 'Pane', requestId: PANE, element, origin: { kind: 'person' } } as never)
}

test('in the pane, down from a prompt lands on the reply below it', async ($, on) => {
  const t = transcript()
  t.prompt('CT-SYN first')
  t.reply([{ type: 'text', text: 'CT-SYN answer' }])
  const world = host(on, t.jsonl())
  await start($, world)
  await mountPane($)

  await arrow($, 'g0.u')
  await arrow($, 'g0.u.1')

  expect(world.focuses.map(f => f.element)).toEqual(['g0.u', 'g0.a'])
})

test('down past the window scrolls it one entry and puts the ring there', async ($, on) => {
  const t = transcript()
  for (let i = 0; i < 12; i++) t.prompt(`CT-SYN prompt ${i}`)
  const world = host(on, t.jsonl())
  await start($, world)
  /* The head, the search row, three 1-line prompts with their gaps, the
     preview's one line (no room for more), the footer. */
  const pane = await mountPane($, 12)
  const prompts = async () => (await entryTexts(pane)).filter(s => s.startsWith('CT-SYN'))

  await $.ui.scroll({ component: 'Pane', requestId: PANE, offset: 0, by: -6, bodyRows: 12, contentRows: 12, origin: { kind: 'person' } } as never)
  expect(await prompts()).toEqual(['CT-SYN prompt 3', 'CT-SYN prompt 4', 'CT-SYN prompt 5'])

  await arrow($, 'g5.u')
  /* The host's own move is refused: the window moves first, and chat-toc
     then lands the ring on the entry brought in. The test engine does not
     hand a plugin's `$.ui.focus` to the test's hooks; where the ring lands
     is checked in the terminal. */
  expect((await arrow($, 'g5.u.1')).deny).toBeDefined()
  await world.clock.advance(1)
  expect(await prompts()).toEqual(['CT-SYN prompt 4', 'CT-SYN prompt 5', 'CT-SYN prompt 6'])
  expect(world.focuses.map(f => f.element)).toEqual(['g5.u'])

  /* Up past the top, onto the search field, scrolls back. */
  await arrow($, 'g4.u')
  expect((await arrow($, 'search')).deny).toBeDefined()
  await world.clock.advance(1)
  expect(await prompts()).toEqual(['CT-SYN prompt 3', 'CT-SYN prompt 4', 'CT-SYN prompt 5'])
})

/* CT-UI-002: a switch keeps the selected group, or the window's top one,
   in view; a window that followed the newest goes on following. */

function focusedPane($: Engine, bodyRows: number) {
  return $.ui.mount({
    plugin: 'chat-toc',
    surface: 'terminal',
    component: 'Pane',
    requestId: PANE,
    viewport: { columns: 160, rows: 40, isFullscreen: true },
    props: { title: '目录', isFocused: true, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows }, view: {} },
  })
}

test('switching the Layout keeps the selected group in view', async ($, on) => {
  const t = transcript()
  for (let i = 0; i < 12; i++) {
    t.prompt(`CT-SYN prompt ${i}`)
    t.reply([{ type: 'text', text: `CT-SYN answer ${i}` }])
  }
  const world = host(on, t.jsonl())
  await start($, world)
  const pane = await focusedPane($, 11)
  const prompts = async () => (await entryTexts(pane)).filter(s => s.startsWith('CT-SYN prompt'))

  await $.ui.scroll({ component: 'Pane', requestId: PANE, offset: 0, by: -10, bodyRows: 11, contentRows: 11, origin: { kind: 'person' } } as never)
  const before = await prompts()
  expect(before).toEqual(['CT-SYN prompt 5', 'CT-SYN prompt 6'])
  await arrow($, 'g6.u')

  await pane.press({ key: 'layout' })
  await world.clock.advance(1)

  /* Compact: the selected group at the top of the window. */
  expect((await prompts())[0]).toBe('CT-SYN prompt 6')
})

test('switching the Layout of a scrolled window keeps its top group at the top', async ($, on) => {
  const t = transcript()
  for (let i = 0; i < 12; i++) t.prompt(`CT-SYN prompt ${i}`)
  const world = host(on, t.jsonl())
  await start($, world)
  const pane = await mountPane($, 11)

  await $.ui.scroll({ component: 'Pane', requestId: PANE, offset: 0, by: -6, bodyRows: 11, contentRows: 11, origin: { kind: 'person' } } as never)
  await pane.press({ key: 'layout' })

  expect((await entryTexts(pane))[0]).toBe('CT-SYN prompt 3')
})

test('switching the Layout of a window that follows the newest goes on following', async ($, on) => {
  const t = transcript()
  for (let i = 0; i < 12; i++) t.prompt(`CT-SYN prompt ${i}`)
  const world = host(on, t.jsonl())
  await start($, world)
  const pane = await mountPane($, 14)

  await pane.press({ key: 'layout' })

  expect((await entryTexts(pane)).at(-1)).toBe('CT-SYN prompt 11')
  expect(world.focuses).toEqual([])
})
