/* The terminal's Minimap: a row of one-cell Buttons over the list, one cell
   per Turn group, as tall (eight levels of block) as the steps of its Agent
   reply, a row of times under it and a blank row. The cells the groups do
   not reach (the conversation has not got there) are drawn as a dim
   baseline, so the row is as wide as the pane. Past the cells the pane's width holds,
   a cell stands for several consecutive groups, as tall as the most steps
   among them. A Button has no colour, so the cell holding the Current
   position is told by the others being dim. */

import { textCells } from './cells'
import type { StripLabels } from './minimap'

const LEVELS = '▁▂▃▄▅▆▇█'
/* Where a cell with nothing to press shows: the lowest block. */
const FLOOR = LEVELS[0] ?? '▁'

/* The rows the Minimap takes: the bars, the times, a blank row to part it
   from the list. */
export const BAR_ROWS = 3
/* Fewer groups than this draw no Minimap. */
export const MIN_BAR_GROUPS = 2
/* The list keeps at least this many rows, or the Minimap leaves. */
export const MIN_LIST_ROWS = 8

/* A cell's Button key: `m.<cell>`. */
export const barKey = (cell: number) => `m.${cell}`
export const isBarKey = (key: unknown) => typeof key === 'string' && /^m\.\d+$/.test(key)

/* One cell: the groups `from` up to (not including) `to`. */
export type Bar = { glyph: string; from: number; to: number }

/* A cell's block: none for no steps, else a square-root scale up to the
   most steps of any group, so a long outlier leaves the rest low but not
   all alike. */
function levelOf(steps: number, most: number): string {
  if (steps <= 0 || most <= 0) return FLOOR
  return LEVELS[1 + Math.min(6, Math.floor(6 * Math.sqrt(steps / most)))] ?? FLOOR
}

/* The cells for groups with these steps, at most `room` of them. `isOff`
   says a group has no Jump target; a cell of such groups only is the
   floor. */
export function barsOf(steps: readonly number[], room: number, isOff: (group: number) => boolean): Bar[] {
  const n = steps.length
  if (n === 0 || room < 1) return []
  const per = Math.max(1, Math.ceil(n / room))
  const most = steps.reduce((a, b) => Math.max(a, b), 0)
  const bars: Bar[] = []
  for (let from = 0; from < n; from += per) {
    const to = Math.min(n, from + per)
    let high = 0
    let isAllOff = true
    for (let g = from; g < to; g++) {
      high = Math.max(high, steps[g] ?? 0)
      if (!isOff(g)) isAllOff = false
    }
    bars.push({ glyph: isAllOff ? FLOOR : levelOf(high, most), from, to })
  }
  return bars
}

/* The cell holding a group. */
export function barOfGroup(bars: readonly Bar[], group: number | undefined): number | undefined {
  if (group === undefined) return undefined
  const at = bars.findIndex(bar => group >= bar.from && group < bar.to)
  return at < 0 ? undefined : at
}

/* The group a press on a cell jumps to: the first of its groups that has a
   Jump target, else the first, whose press says why it cannot. */
export function barTarget(bar: Bar, isOff: (group: number) => boolean): number {
  for (let g = bar.from; g < bar.to; g++) if (!isOff(g)) return g
  return bar.from
}

/* Whether the Minimap is drawn: two groups or more, and the list left at
   least MIN_LIST_ROWS rows without them taken. */
export function hasBars(groups: number, listRows: number): boolean {
  return groups >= MIN_BAR_GROUPS && listRows - BAR_ROWS >= MIN_LIST_ROWS
}

/* The times under the cells: the first group's at the left, the last
   group's at the right. `first` is its day and time; when both do not fit
   the width, the day goes first. */
export function barLabels({ first, last }: StripLabels, width: number): { left: string; right: string; gap: number } {
  const fits = (left: string) => textCells(left) + (left && last ? 1 : 0) + textCells(last) <= width
  const shortened = first.slice(first.lastIndexOf(' ') + 1)
  const left = fits(first) ? first : fits(shortened) ? shortened : ''
  return { left, right: last, gap: Math.max(0, width - textCells(left) - textCells(last)) }
}
