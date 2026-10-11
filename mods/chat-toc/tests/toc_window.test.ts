import { expect, test } from 'claude-code/testing'
import { scrolledTop, windowOf } from '../hooks/window'
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

test('the wheel over the pane moves its window, and the newest shows first', async ($, on) => {
  const t = transcript()
  for (let i = 0; i < 12; i++) t.prompt(`CT-SYN prompt ${i}`)
  const world = host(on, t.jsonl())
  await start($, world)
  const pane = await mountPane($, 10)

  const shown = async () => (await entryTexts(pane)).filter(s => s.startsWith('CT-SYN'))
  expect(await shown()).toEqual(['CT-SYN prompt 9', 'CT-SYN prompt 10', 'CT-SYN prompt 11'])

  await $.ui.scroll({ component: 'Pane', requestId: PANE, offset: 0, by: -3, bodyRows: 10, contentRows: 10, origin: { kind: 'person' } } as never)
  expect(await shown()).toEqual(['CT-SYN prompt 6', 'CT-SYN prompt 7', 'CT-SYN prompt 8'])
})
