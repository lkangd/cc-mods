import { expect, test } from 'claude-code/testing'
import { scrolledTop, topOfDrawing, windowOf } from '../hooks/window'
import { PANE, entryTexts, host, mountPane, start } from './host'
import { transcript } from './fixture'

/* The pane draws only the entries in view, and follows the newest until the
   person scrolls it. */

test('with no scroll the window shows the newest entries that fit', () => {
  /* Five entries of three rows, a gap after each but the last. */
  expect(windowOf([4, 4, 4, 4, 3], 11, undefined)).toEqual({ start: 2, end: 5, maxStart: 2 })
})

test('a window taller than every entry shows them all from the first', () => {
  expect(windowOf([4, 3], 20, undefined)).toEqual({ start: 0, end: 2, maxStart: 0 })
})

test('an entry taller than the window still shows', () => {
  expect(windowOf([9], 4, undefined)).toEqual({ start: 0, end: 1, maxStart: 0 })
})

test('a scrolled window starts where the person left it, kept inside the list', () => {
  expect(windowOf([4, 4, 4, 4, 3], 11, 1)).toEqual({ start: 1, end: 3, maxStart: 2 })
  expect(windowOf([4, 4, 4, 4, 3], 11, 9)).toEqual({ start: 2, end: 5, maxStart: 2 })
})

test('scrolling back to the end follows the newest again', () => {
  const at = { start: 1, end: 3, maxStart: 2 }
  expect(scrolledTop(at, -1)).toBe(0)
  expect(scrolledTop(at, -5)).toBe(0)
  expect(scrolledTop(at, 1)).toBeUndefined()
})

/* Ten one-group entries of three rows, three to a window: the newest
   window starts at entry 7. */
const KEYS = Array.from({ length: 10 }, (_, g) => `g${g}.u`)
const DRAWN = { heights: KEYS.map(() => 3), rows: 9, keys: KEYS, indexOf: new Map(KEYS.map((key, i) => [key, i])) }

test('a drawing that follows keeps the lit entry in view, one entry below the top', () => {
  expect(topOfDrawing(DRAWN, { top: undefined, follow: { index: 2, isLast: false }, anchor: undefined })).toEqual({ top: 1, refocusKey: undefined })
  /* Already in view: the window stays. */
  expect(topOfDrawing(DRAWN, { top: 1, follow: { index: 3, isLast: false }, anchor: undefined })).toEqual({ top: 1, refocusKey: undefined })
  /* The last group lit, or none: the newest. */
  expect(topOfDrawing(DRAWN, { top: 1, follow: { index: 9, isLast: true }, anchor: undefined }).top).toBeUndefined()
  expect(topOfDrawing(DRAWN, { top: 1, follow: { index: undefined, isLast: false }, anchor: undefined }).top).toBeUndefined()
})

test('a held drawing leaves the window where it is', () => {
  expect(topOfDrawing(DRAWN, { top: 4, follow: undefined, anchor: undefined })).toEqual({ top: 4, refocusKey: undefined })
})

test("after a switch the window's top group is put back at the top", () => {
  expect(topOfDrawing(DRAWN, { top: 2, follow: undefined, anchor: { by: 'top', group: 5, index: 5, wasFollowing: false } })).toEqual({
    top: 5,
    refocusKey: undefined,
  })
})

test('after a switch the selected entry is brought to the top, and the ring is sent back to it', () => {
  /* Out of the newest window the person followed. */
  expect(topOfDrawing(DRAWN, { top: undefined, follow: undefined, anchor: { by: 'ring', ring: 'g2.u', group: 2, index: 2, wasFollowing: true } })).toEqual({
    top: 2,
    refocusKey: 'g2.u',
  })
  /* In the newest window the person followed: it goes on following. */
  expect(topOfDrawing(DRAWN, { top: undefined, follow: undefined, anchor: { by: 'ring', ring: 'g8.u', group: 8, index: 8, wasFollowing: true } })).toEqual({
    top: undefined,
    refocusKey: 'g8.u',
  })
  /* The selected side is filtered out: its group's first entry. */
  expect(topOfDrawing(DRAWN, { top: 6, follow: undefined, anchor: { by: 'ring', ring: 'g4.a', group: 4, index: 4, wasFollowing: false } })).toEqual({
    top: 4,
    refocusKey: 'g4.u',
  })
})

test('after a switch the lit group is brought into view as little as it takes', () => {
  expect(topOfDrawing(DRAWN, { top: 4, follow: undefined, anchor: { by: 'lit', group: 1, index: 1, wasFollowing: false } })).toEqual({
    top: 1,
    refocusKey: undefined,
  })
  expect(topOfDrawing(DRAWN, { top: 4, follow: undefined, anchor: { by: 'lit', group: 5, index: 5, wasFollowing: false } })).toEqual({
    top: 4,
    refocusKey: undefined,
  })
})

test('the wheel over the pane moves its window, and the newest shows first', async ($, on) => {
  const t = transcript()
  for (let i = 0; i < 12; i++) t.prompt(`CT-SYN prompt ${i}`)
  const world = host(on, t.jsonl())
  await start($, world)
  const pane = await mountPane($, 10)

  const shown = async () => (await entryTexts(pane)).filter(s => s.startsWith('CT-SYN'))
  expect(await shown()).toEqual(['CT-SYN prompt 9', 'CT-SYN prompt 10', 'CT-SYN prompt 11'])

  await $.ui.scroll({ component: 'Pane', requestId: PANE, offset: 0, by: -3, bodyRows: 10, contentRows: 10, origin: { kind: 'person' } } as never)
  /* Scrolled, the window keeps its rows. */
  expect(await shown()).toEqual(['CT-SYN prompt 6', 'CT-SYN prompt 7', 'CT-SYN prompt 8'])
})
