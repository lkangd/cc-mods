/* Drawing the pane on Claude Code Desktop and the other remote surfaces,
   from what the desktop was measured to draw (ticket 36). A plain Button is
   one line of bare text there, dim or not, pressable, nothing more; so each
   line of an entry is one, the lines folded as the terminal folds them. All
   that only decorates is an Svg: the filters' well and lit slot under three
   plain Buttons, the strip of bars, and beside each entry its time, node or
   branch and rail, as tall as its lines, so the rails of neighbours meet.
   A Box's width and height count cells there, as on the terminal. The
   desktop reports no Current position: nothing is lit, nothing pauses.

   The 0.2 additions (spec §8): a native search field under the segmented
   control (no `f` Button), the strip drawing the matches in the accent
   colour and the context use after its count; the compaction rules as
   dashed Svgs placed as on the terminal, and the fork line; the preview
   with its content drawn by pane.tsx, its hotkeys gone, so the rule, the
   cut line and Back are plain Buttons; copy without Reuse (reuse.ts). No
   ‹ ›: nothing walks on the desktop. */

import type { ElementTable, RenderElement } from 'claude-code'
import { textCells } from './cells'
import { GUTTER, RUNNING_MARK, dayRuleBefore } from './entries'
import type { Entry } from './entries'
import type { CompactionRule } from './compactions'
import { MINIMAP_HEIGHT, minimapOf } from './minimap'
import type { StripLabels } from './minimap'
import { SEARCH_FIELD, compactionLabel, expandedContent, previewContent } from './pane'
import type { ExpandedView, PreviewView } from './pane'
import { BACK_CONTROL, MORE_CONTROL, PREVIEW_CONTROL } from './preview'
import { FIRST_CONTROL, LAYOUT_CONTROL } from './ring'
import { FILTERS, filterLabel, layoutLabel, layoutName, layoutOf } from './view'
import { text as words } from './text'
import type { Layout, ViewFilter } from './view'
import type { TocWindow } from './window'

/* A cell's width and a row's height on the desktop, in CSS px. */
export const CELL_PX = 8.2
export const ROW_PX = 19

const LAYOUTS: readonly Layout[] = ['card', 'compact', 'timeline']
const TIME_CELLS = 6
/* The rail's cells: the terminal's gutter without a time column. */
const RAIL_CELLS = GUTTER.card
const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','PingFang SC',sans-serif"
/* The cells a filter's slot adds around its label. */
const SLOT_PAD = 4
const WELL_ROWS = 2

/* The search field under the segmented control: a native field whose
   submit (Enter, or its `show` button) keeps the text and puts the nearest
   match in the preview; while there is a query, the count of matches. */
export type DesktopSearch = {
  query: string
  count: { matches: number; of: number } | undefined
  onInput: (value: string) => void
  onSubmit: (value: string) => Promise<void>
}

export type DesktopView = {
  entries: readonly Entry[]
  window: TocWindow
  layout: Layout
  filter: ViewFilter
  /* The steps of each Turn group the list holds, for the strip of bars. */
  steps: readonly number[]
  runningGroup: number | undefined
  stripLabels: StripLabels
  notice: string | undefined
  alert: { text: string; isInverse: boolean } | undefined
  why: string | undefined
  count: number | undefined
  /* Whether the list starts with the line saying earlier turns are not in
     this session's file. */
  isEarlierElsewhere: boolean
  /* The context use, a whole percent; undefined leaves it out. */
  contextPercent: number | undefined
  search: DesktopSearch
  /* The matching groups while a query is set, for the strip. */
  matches: readonly number[] | undefined
  /* The preview under the list; undefined draws none. */
  preview: PreviewView | undefined
  /* The expanded preview, drawn in place of the strip, the list and the
     preview; undefined draws those. */
  expanded: ExpandedView | undefined
  bodyColumns: number
  onPress: (entry: Entry) => Promise<void>
  onFilter: (filter: ViewFilter) => Promise<void>
  onLayout: (layout?: Layout) => Promise<void>
}

const xml = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
const px = (n: number) => Math.round(n * 10) / 10

const svgOf = (w: number, h: number, style: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${px(w)}" height="${h}" viewBox="0 0 ${px(w)} ${h}"><style>${style}</style>${body}</svg>`

/* The rail's colours: the rail, a node's ring, the time, a hollow mark. */
const RAIL_STYLE =
  '.l{fill:#d3d2cd}.n{fill:none;stroke:#8f8e89;stroke-width:1.5}.o{fill:none;stroke:#b8b7b2;stroke-width:1.2;stroke-dasharray:2 2}' +
  '.t{fill:#8a8985}.r{fill:#d77757;animation:p 1.4s ease-in-out infinite}@keyframes p{50%{opacity:.35}}' +
  '@media (prefers-color-scheme: dark){.l{fill:#41413e}.n{stroke:#a3a29d}.o{stroke:#5d5c58}.t{fill:#8f8e89}}' +
  '@media (prefers-reduced-motion: reduce){.r{animation:none}}'

/* A label's width in the desktop's 13 px system font, roughly: a CJK
   character a full em, other characters a little over half. */
const labelPx = (label: string) => [...label].reduce((w, ch) => w + (textCells(ch) === 2 ? 13 : 7.4), 0)

/* The filters' well and the chosen one's pill, under the three plain
   Buttons. The pill is the size and shape of the box the desktop draws
   under a hovered Button, centred where the label is, so a hover over the
   chosen one meets it and a hover elsewhere reads as the same pill. */
function wellSvg(labels: readonly string[], slots: readonly number[], chosen: number): string {
  const w = slots.reduce((a, b) => a + b, 0) * CELL_PX
  const h = WELL_ROWS * ROW_PX
  const centre = (slots.slice(0, chosen).reduce((a, b) => a + b, 0) + (slots[chosen] ?? 0) / 2) * CELL_PX
  const pill = labelPx(labels[chosen] ?? '') + 16
  return svgOf(
    w,
    h,
    '.w{fill:#ecebe6}.p{fill:#ffffff}@media (prefers-color-scheme: dark){.w{fill:#2c2c2a}.p{fill:#3f3f3c}}',
    `<rect class="w" x="0" y="3" width="${px(w)}" height="${h - 6}" rx="8"/><rect class="p" x="${px(centre - pill / 2)}" y="${h / 2 - 11}" width="${px(pill)}" height="22" rx="5"/>`,
  )
}

/* Beside an entry: its time on its first line where the Layout has a time
   column, the rail down all its lines, on the first line a ring for a User
   input or a branch for an Agent reply (hollow and dashed with no Jump
   target), and a running reply's mark. The first entry under the window's
   top or a day's rule starts its rail at its ring. */
function railSvg(entry: Entry, hasTime: boolean, isStart: boolean): { source: string; width: number; height: number } {
  const cells = (hasTime ? TIME_CELLS : 0) + RAIL_CELLS + (entry.isRunning ? RUNNING_MARK : 0)
  const width = cells * CELL_PX
  const height = entry.lines.length * ROW_PX
  const x = (hasTime ? TIME_CELLS * CELL_PX : 0) + 6
  const cy = ROW_PX / 2
  const isOff = entry.isOff === true
  const parts: string[] = []
  if (hasTime && entry.time !== '') parts.push(`<text class="t" x="0" y="${cy + 4}" font-size="12" font-family="${FONT}">${xml(entry.time)}</text>`)
  const top = isStart && entry.side === 'user' ? cy : 0
  parts.push(`<rect class="l" x="${px(x - 0.75)}" y="${top}" width="1.5" height="${height - top}"/>`)
  if (entry.side === 'user') {
    parts.push(`<circle class="l" cx="${px(x)}" cy="${cy}" r="5"/>`)
    parts.push(`<circle class="${isOff ? 'o' : 'n'}" cx="${px(x)}" cy="${cy}" r="4"/>`)
  } else {
    parts.push(isOff ? `<rect class="o" x="${px(x)}" y="${cy}" width="9" height="0.1"/>` : `<rect class="l" x="${px(x)}" y="${cy - 0.75}" width="9" height="1.5"/>`)
  }
  if (entry.isRunning) {
    const mx = (hasTime ? TIME_CELLS * CELL_PX : 0) + RAIL_CELLS * CELL_PX + 6
    parts.push(`<circle class="r" cx="${px(mx)}" cy="${cy}" r="4.5"/>`)
  }
  return { source: svgOf(width, height, RAIL_STYLE, parts.join('')), width, height }
}

/* A blank row between Turn groups: the rail goes on through it. */
function gapSvg(hasTime: boolean): { source: string; width: number } {
  const width = (RAIL_CELLS + (hasTime ? TIME_CELLS : 0)) * CELL_PX
  const x = (hasTime ? TIME_CELLS * CELL_PX : 0) + 6
  return { source: svgOf(width, ROW_PX, RAIL_STYLE, `<rect class="l" x="${px(x - 0.75)}" y="0" width="1.5" height="${ROW_PX}"/>`), width }
}

/* A day's rule across the body: the day, dim, then a thin line. */
function ruleSvg(day: string, width: number): string {
  const end = textCells(day) * 6.4 + 10
  return svgOf(
    width,
    ROW_PX,
    RAIL_STYLE,
    `<text class="t" x="0" y="${ROW_PX / 2 + 4}" font-size="12" font-family="${FONT}">${xml(day)}</text><rect class="l" x="${px(end)}" y="${ROW_PX / 2}" width="${px(Math.max(0, width - end))}" height="1"/>`,
  )
}

/* A thin rule across `width` px, beside the preview's Button. */
function lineSvg(width: number): string {
  return svgOf(width, ROW_PX, RAIL_STYLE, `<rect class="l" x="0" y="${ROW_PX / 2}" width="${px(width)}" height="1"/>`)
}

/* The preview as on the terminal, its hotkeys gone: the rule a Button
   showing or hiding it, the cut line a Button expanding it. */
function drawPreview(elements: ElementTable, preview: PreviewView, bodyColumns: number): RenderElement {
  const { Box, Button } = elements
  const label = preview.state === 'noRoom' ? words.previewNoRoom : words.preview
  const rest = Math.max(0, bodyColumns - textCells(label) - 1) * CELL_PX
  const rule = (
    <Box flexDirection="row" alignItems="center" columnGap={1}>
      <Button key={PREVIEW_CONTROL} plain dimColor={preview.state !== 'shown'} onPress={() => preview.onToggle()}>
        {label}
      </Button>
      {'Svg' in elements ? <elements.Svg source={lineSvg(rest)} alt="" width={px(rest)} height={ROW_PX} /> : null}
    </Box>
  )
  const body = preview.state === 'shown' ? preview.body : undefined
  return (
    <Box flexDirection="column">
      {rule}
      {body === undefined ? null : previewContent(elements, body, preview.actions, false)}
      {body === undefined || body.more === 0 ? null : (
        <Button key={MORE_CONTROL} plain dimColor onPress={() => preview.onMore()}>
          {words.moreLines(body.more) + words.expand}
        </Button>
      )}
    </Box>
  )
}

/* A compaction's rule across the body, like the day's but dashed: its
   words, dim, then a dashed line. */
function compactionSvg(label: string, width: number): string {
  const end = textCells(label) * 6.4 + 10
  return svgOf(
    width,
    ROW_PX,
    RAIL_STYLE + '.c{stroke:#d3d2cd;stroke-width:1;stroke-dasharray:3 3}@media (prefers-color-scheme: dark){.c{stroke:#41413e}}',
    `<text class="t" x="0" y="${ROW_PX / 2 + 4}" font-size="12" font-family="${FONT}">${xml(label)}</text><line class="c" x1="${px(end)}" y1="${ROW_PX / 2 + 0.5}" x2="${px(width)}" y2="${ROW_PX / 2 + 0.5}"/>`,
  )
}

export function drawDesktopPane(elements: ElementTable, view: DesktopView): RenderElement {
  const { Box, Text, Button } = elements
  const hasSvg = 'Svg' in elements
  const svg = (source: string, alt: string, width: number, height: number) =>
    'Svg' in elements ? <elements.Svg source={source} alt={alt} width={px(width)} height={height} /> : null
  const width = Math.round(view.bodyColumns * CELL_PX)
  const slots = FILTERS.map(f => textCells(filterLabel(f.filter)) + SLOT_PAD)
  const chosen = Math.max(0, FILTERS.findIndex(f => f.filter === view.filter))
  const buttons = FILTERS.map((f, i) => (
    <Box key={`slot-${f.filter}`} width={slots[i]} height={WELL_ROWS} justifyContent="center" alignItems="center">
      <Button
        key={f.filter === 'all' ? FIRST_CONTROL : `f-${f.filter}`}
        plain
        dimColor={f.filter !== view.filter}
        onPress={() => view.onFilter(f.filter)}
      >
        {filterLabel(f.filter)}
      </Button>
    </Box>
  ))
  const filters = hasSvg ? (
    <Box position="relative" width={slots.reduce((a, b) => a + b, 0)} height={WELL_ROWS}>
      {svg(wellSvg(FILTERS.map(f => filterLabel(f.filter)), slots, chosen), words.filterAlt(filterLabel(view.filter)), slots.reduce((a, b) => a + b, 0) * CELL_PX, WELL_ROWS * ROW_PX)}
      <Box position="absolute" top={0} left={0} flexDirection="row">
        {buttons}
      </Box>
    </Box>
  ) : (
    <Box flexDirection="row">{buttons}</Box>
  )
  const layoutControl =
    'Select' in elements ? (
      <elements.Select
        key={LAYOUT_CONTROL}
        options={LAYOUTS.map(l => ({ value: l, label: layoutName(l) }))}
        value={view.layout}
        onSelect={value => void view.onLayout(layoutOf(value))}
      />
    ) : (
      <Button key={LAYOUT_CONTROL} plain onPress={() => view.onLayout()}>
        {layoutLabel(view.layout)}
      </Button>
    )
  const strip =
    hasSvg && view.steps.length > 0
      ? (() => {
          const map = minimapOf(view.steps, view.runningGroup, width, view.stripLabels, { matches: view.matches, percent: view.contextPercent })
          return svg(map.source, map.alt, width, MINIMAP_HEIGHT)
        })()
      : null
  const searchRow =
    'Input' in elements ? (
      <Box flexDirection="row" alignItems="center">
        <Box flexGrow={1} flexShrink={1}>
          <elements.Input
            key={SEARCH_FIELD}
            placeholder={words.searchPlaceholder}
            value={view.search.query}
            submitLabel={words.searchShow}
            onInput={(value: string) => view.search.onInput(value)}
            onSubmit={(value: string) => view.search.onSubmit(value)}
          />
        </Box>
        {view.search.count === undefined ? null : <Text dimColor>{' ' + words.matchCount(view.search.count.matches, view.search.count.of)}</Text>}
      </Box>
    ) : null
  const hasTime = view.layout !== 'card'
  /* Not pressable, breaking the rail as the day's rule does. */
  const compactionRow = (rule: CompactionRule) => {
    const label = compactionLabel(rule)
    return hasSvg ? svg(compactionSvg(label, width), label, width, ROW_PX)! : <Text dimColor>{label}</Text>
  }
  const rows: RenderElement[] = []
  for (let i = view.window.start; i < view.window.end; i++) {
    const entry = view.entries[i]
    if (!entry) continue
    const rule = dayRuleBefore(view.entries, i)
    if (rule !== undefined) rows.push(hasSvg ? svg(ruleSvg(rule, width), rule, width, ROW_PX)! : <Text dimColor>{rule}</Text>)
    if (entry.compactionBefore !== undefined) rows.push(compactionRow(entry.compactionBefore))
    const press = () => view.onPress(entry)
    const rail = railSvg(entry, hasTime, i === view.window.start || rule !== undefined || entry.compactionBefore !== undefined)
    const line = (text: string, n: number, dim: boolean) => (
      <Button key={n === 0 ? entry.key : `${entry.key}.${n}`} plain dimColor={dim} onPress={press}>
        {text || ' '}
      </Button>
    )
    rows.push(
      <Box key={`row-${entry.key}`} flexDirection="row">
        {svg(rail.source, words.rail, rail.width, rail.height)}
        <Box flexDirection="column" flexShrink={1}>
          {entry.lines.map((l, n) =>
            l.aside === undefined ? (
              line(l.text, n, l.dim)
            ) : (
              <Box flexDirection="row" width={view.bodyColumns - RAIL_CELLS} justifyContent="space-between">
                {line(l.text, n, l.dim)}
                <Text dimColor>{l.aside}</Text>
              </Box>
            ),
          )}
        </Box>
      </Box>,
    )
    const hasGap = entry.gapAfter && i < view.window.end - 1
    if (hasGap) {
      if (dayRuleBefore(view.entries, i + 1) !== undefined || view.entries[i + 1]?.compactionBefore !== undefined) rows.push(<Text> </Text>)
      else {
        const gap = gapSvg(hasTime)
        rows.push(<Box flexDirection="row">{svg(gap.source, words.rail, gap.width, ROW_PX)}</Box>)
      }
    }
    if (entry.compactionAfter !== undefined) rows.push(compactionRow(entry.compactionAfter))
  }
  const head = (
    <Box flexDirection="row" justifyContent="space-between" alignItems="center">
      {filters}
      {layoutControl}
    </Box>
  )
  if (view.expanded !== undefined) {
    const expanded = view.expanded
    return (
      <Box flexDirection="column" gap={1}>
        {head}
        {searchRow}
        <Box flexDirection="column">
          <Button key={BACK_CONTROL} plain onPress={() => expanded.onBack()}>
            {words.back}
          </Button>
          {expandedContent(elements, expanded, false)}
        </Box>
      </Box>
    )
  }
  return (
    <Box flexDirection="column" gap={1}>
      {head}
      {searchRow}
      {strip}
      {view.isEarlierElsewhere ? <Text dimColor>{words.earlierElsewhere}</Text> : null}
      {view.notice === undefined ? null : <Text dimColor>{view.notice}</Text>}
      <Box flexDirection="column">{rows}</Box>
      {view.alert === undefined ? null : <Text color="warning">{`⚠ ${view.alert.text}`}</Text>}
      {view.why === undefined ? null : <Text dimColor>{view.why}</Text>}
      {view.preview === undefined ? null : drawPreview(elements, view.preview, view.bodyColumns)}
      {strip === null && view.count !== undefined ? <Text dimColor>{words.turns(view.count)}</Text> : null}
    </Box>
  )
}
