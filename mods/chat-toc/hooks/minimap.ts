/* The desktop's strip of bars over the list: one bar per Turn group, as
   tall as the steps its agent took, a running one's in Claude's colour,
   pulsing; under the bars the first group's day and time, the count and the
   last group's time. An SVG the surface draws as an image; it carries its
   own light and dark colours and stops pulsing under reduced motion. Past
   MAX_BARS groups a bar stands for several, as tall as the most steps among
   them. The desktop reports no Current position, so no bar is lit; while
   a query is set the bars holding a match are drawn in the accent colour
   and the rest dim. The context use, when the host gives one, follows the
   count on the line under the bars. */

import { textCells } from './cells'
import { clockTime, dayLabel } from './entries'
import { text as words, turnsAndContextUse } from './text'

const BARS_HEIGHT = 36
const LABEL_HEIGHT = 20
export const MINIMAP_HEIGHT = BARS_HEIGHT + LABEL_HEIGHT
const MAX_BARS = 120
/* Fewer groups than this still draw bars this narrow, from the left. */
const MIN_SLOTS = 10
const MOST = 32
const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','PingFang SC',sans-serif"

export type Minimap = { source: string; alt: string }
export type StripLabels = { first: string; last: string }

const xml = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

/* The first group's day (never as today) and time, and the last group's
   `HH:MM`; '' where the transcript has no time. */
export function stripLabels(first: string | undefined, last: string | undefined, nowMs: number): StripLabels {
  const day = dayLabel(first, nowMs, false)
  return { first: [day, clockTime(first)].filter(Boolean).join(' '), last: clockTime(last) }
}

/* What the strip marks besides the bars: a query's matching groups (in
   order; undefined with no query) and the context use. */
export type StripMarks = { matches?: readonly number[] | undefined; percent?: number | undefined }

/* A label's width in px at 11 px: a CJK character a full em, others a
   little over half. */
const labelPx = (s: string) => [...s].reduce((w, ch) => w + (textCells(ch) === 2 ? 11 : 6.3), 0)

/* The middle label: the count, then the context use, long while the three
   labels fit the width with room between them, else short, else none. */
function middleLabel(n: number, labels: StripLabels, width: number, percent: number | undefined): string {
  const sides = 2 * Math.max(labelPx(labels.first), labelPx(labels.last))
  return turnsAndContextUse(n, percent, middle => sides + labelPx(middle) + 24 <= width)
}

export function minimapOf(steps: readonly number[], running: number | undefined, width: number, labels: StripLabels, marks: StripMarks = {}): Minimap {
  const n = steps.length
  const matched = marks.matches === undefined ? undefined : new Set(marks.matches)
  const per = Math.max(1, Math.ceil(n / MAX_BARS))
  const bars = Math.ceil(n / per)
  const slot = width / Math.max(MIN_SLOTS, bars)
  const rects: string[] = []
  for (let b = 0; b < bars; b++) {
    const from = b * per
    const to = Math.min(n, from + per)
    let most = 0
    for (let i = from; i < to; i++) most = Math.max(most, steps[i] ?? 0)
    const h = most === 0 ? 4 : Math.min(MOST, 6 + most * 3)
    let isMatched = false
    for (let i = from; i < to && matched !== undefined && !isMatched; i++) isMatched = matched.has(i)
    const cls = running !== undefined && running >= from && running < to ? 'r' : matched === undefined ? 'b' : isMatched ? 'm' : 'd'
    rects.push(`<rect class="${cls}" x="${(b * slot + slot * 0.18).toFixed(1)}" y="${BARS_HEIGHT - h}" width="${Math.max(1, slot * 0.64).toFixed(1)}" height="${h}" rx="3"/>`)
  }
  const y = BARS_HEIGHT + 15
  const text = (x: number, anchor: string, s: string) =>
    `<text class="t" x="${x.toFixed(1)}" y="${y}" text-anchor="${anchor}" font-size="11" font-family="${FONT}">${xml(s)}</text>`
  const style =
    '<style>.b{fill:#dcdbd6}.d{fill:#dcdbd6;opacity:.45}.m{fill:#d77757}.r{fill:#d77757;animation:p 1.4s ease-in-out infinite}.t{fill:#8a8985}' +
    '@keyframes p{50%{opacity:.35}}' +
    '@media (prefers-color-scheme: dark){.b,.d{fill:#3b3b38}.t{fill:#8f8e89}}' +
    '@media (prefers-reduced-motion: reduce){.r{animation:none}}</style>'
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${MINIMAP_HEIGHT}" viewBox="0 0 ${width} ${MINIMAP_HEIGHT}">${style}${rects.join('')}` +
    text(0, 'start', labels.first) +
    text(width / 2, 'middle', middleLabel(n, labels, width, marks.percent)) +
    text(width, 'end', labels.last) +
    '</svg>'
  const alt = words.stripAlt(n, per)
  return { source, alt }
}
