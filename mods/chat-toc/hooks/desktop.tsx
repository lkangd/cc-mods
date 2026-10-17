/* Drawing the pane on Claude Code Desktop and the other remote surfaces,
   from what the desktop was measured to draw (ticket 36). A plain Button is
   one line of bare text there, dim or not, pressable, nothing more; so each
   line of an entry is one, the lines folded as the terminal folds them. All
   that only decorates is an Svg: the strip of bars, and beside each run of
   entries one rail with their times, nodes and branches, as tall as their
   lines. A Box's width and height count cells there, as on the terminal.
   The desktop reports no Current position: nothing is lit, nothing pauses.

   The 0.2 additions (spec §8): the filters as native Buttons beside the
   Layout Select, one native height; a native search field under them (no
   `f` Button) with a ✕ while there is a query, the strip drawing the
   matches in the accent colour and the context use after its count; the
   compaction rules as dashed Svgs placed as on the terminal, and the fork
   line; the preview, closed until a press, in a bordered Box under the
   pressed group, its content drawn by pane.tsx, its hotkeys gone, so its ✕,
   the cut line and Back are plain Buttons; copy without Reuse (reuse.ts);
   a Button back to the pane's top after the list. No ‹ ›: nothing walks on
   the desktop. */

import type { ElementTable, RenderElement } from 'claude-code'
import { textCells } from './cells'
import { GUTTER, RUNNING_MARK, dayRuleBefore, isRuleBefore } from './entries'
import type { Entry } from './entries'
import type { CompactionRule } from './compactions'
import { MINIMAP_HEIGHT, minimapOf } from './minimap'
import type { StripLabels } from './minimap'
import { CLEAR_CONTROL, SEARCH_FIELD, compactionLabel, expandedContent, matchCount, previewContent } from './pane'
import type { ExpandedView, PreviewView, SearchView } from './pane'
import { MORE_CONTROL, PREVIEW_CONTROL } from './preview'
import { FIRST_CONTROL, LAYOUT_CONTROL } from './ring'
import type { SpanList } from './span'
import { FILTERS, filterLabel, layoutLabel, layoutName, layoutOf } from './view'
import { text as words } from './text'
import type { Layout, ViewFilter } from './view'
import type { TocWindow } from './window'

/* The Buttons moving the drawn part of the list to earlier and to later
   turns, and the one scrolling the pane back to its top. */
export const EARLIER_CONTROL = 'list.earlier'
export const LATER_CONTROL = 'list.later'
export const TOP_CONTROL = 'list.top'

/* A cell's width and a row's height on the desktop, in CSS px. */
export const CELL_PX = 8.2
export const ROW_PX = 19

const LAYOUTS: readonly Layout[] = ['card', 'compact', 'timeline']
const TIME_CELLS = 6
/* The rail's cells: the terminal's gutter without a time column. */
const RAIL_CELLS = GUTTER.card
const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','PingFang SC',sans-serif"

/* The search field under the filters: a native field whose submit (Enter,
   or its `show` button) keeps the text and puts the nearest match in the
   preview; while there is a query, the count of matches and a ✕ emptying
   it. */
export type DesktopSearch = Pick<SearchView, 'query' | 'count' | 'onInput' | 'onSubmit' | 'onClear'>

/* Where the drawn part of the list moves: to earlier turns from its top,
   to later ones from its bottom; `count` Turn groups are left out there. */
export type ListMove = { count: number; onPress: () => Promise<void> }

export type DesktopView = {
  entries: readonly Entry[]
  /* The drawn part of the list (span.ts), not a window by rows: the host
     scrolls the tree. */
  window: TocWindow
  earlier: ListMove | undefined
  later: ListMove | undefined
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
  /* The preview while it is open, drawn under `previewGroup`'s last drawn
     entry, or at the list's top when none of it is drawn; undefined draws
     none. */
  preview: PreviewView | undefined
  previewGroup: number | undefined
  /* The expanded preview, drawn in place of the strip, the list and the
     preview; undefined draws those. */
  expanded: ExpandedView | undefined
  bodyColumns: number
  onPress: (entry: Entry) => Promise<void>
  onFilter: (filter: ViewFilter) => Promise<void>
  onLayout: (layout?: Layout) => Promise<void>
  onTop: () => Promise<void>
}

const xml = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
const px = (n: number) => Math.round(n * 10) / 10

const svgOf = (w: number, h: number, style: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${px(w)}" height="${h}" viewBox="0 0 ${px(w)} ${h}"><style>${style}</style>${body}</svg>`

/* The rules' colours: the line and the words. */
const RULE_STYLE = `.l{fill:#d3d2cd}.t{fill:#8a8985;font:12px ${FONT}}@media (prefers-color-scheme: dark){.l{fill:#41413e}.t{fill:#8f8e89}}`
/* The rail's colours: the rail, a node's ring, the time, a hollow mark, a
   running reply's mark. */
const RAIL_STYLE =
  '.l{fill:#d3d2cd}.n{fill:none;stroke:#8f8e89;stroke-width:1.5}.o{fill:none;stroke:#b8b7b2;stroke-width:1.2;stroke-dasharray:2 2}' +
  `.t{fill:#8a8985;font:12px ${FONT}}.r{fill:#d77757;animation:p 1.4s ease-in-out infinite}@keyframes p{50%{opacity:.35}}` +
  '@media (prefers-color-scheme: dark){.l{fill:#41413e}.n{stroke:#a3a29d}.o{stroke:#5d5c58}.t{fill:#8f8e89}}' +
  '@media (prefers-reduced-motion: reduce){.r{animation:none}}'

/* The rail's x, and its width in cells, for a Layout with or without a
   time column; a running reply's mark takes cells after it. */
const railX = (hasTime: boolean) => (hasTime ? TIME_CELLS * CELL_PX : 0) + 6
const railCells = (hasTime: boolean, isRunning: boolean) => (hasTime ? TIME_CELLS : 0) + RAIL_CELLS + (isRunning ? RUNNING_MARK : 0)

/* What an entry hangs on the rail, its first line `y` px down: its time
   where the Layout has a time column, a ring for a User input or a branch
   for an Agent reply (hollow and dashed with no Jump target), and a running
   reply's mark. */
function nodeOf(entry: Entry, hasTime: boolean, y: number): string {
  const x = railX(hasTime)
  const cy = y + ROW_PX / 2
  const isOff = entry.isOff === true
  const parts: string[] = []
  if (hasTime && entry.time !== '') parts.push(`<text class="t" x="0" y="${cy + 4}">${xml(entry.time)}</text>`)
  if (entry.side === 'user') {
    parts.push(`<circle class="l" cx="${px(x)}" cy="${cy}" r="5"/>`)
    parts.push(`<circle class="${isOff ? 'o' : 'n'}" cx="${px(x)}" cy="${cy}" r="4"/>`)
  } else {
    parts.push(isOff ? `<rect class="o" x="${px(x)}" y="${cy}" width="9" height="0.1"/>` : `<rect class="l" x="${px(x)}" y="${cy - 0.75}" width="9" height="1.5"/>`)
  }
  if (entry.isRunning) parts.push(`<circle class="r" cx="${px(x + RAIL_CELLS * CELL_PX)}" cy="${cy}" r="4.5"/>`)
  return parts.join('')
}

/* A run of entries the rail goes down unbroken, and whether a blank row
   follows each, the rail going on through it; `rows` the rows it takes. */
type Run = { items: { entry: Entry; hasGap: boolean }[]; isStart: boolean; rows: number }

/* The host refuses the whole tree for an Svg over 4,096 px either way:
   the rows a rail run may take before another starts. */
const SVG_MAX_PX = 4096
const RUN_ROWS = Math.floor(SVG_MAX_PX / ROW_PX)

/* One rail beside a run: down all its rows, starting at the first entry's
   ring when the run starts the drawn part or follows a rule, with each
   entry's node at its first line. One Svg for the run, so its style sheet
   is written once, not once per entry. */
function railSvg(run: Run, hasTime: boolean): { source: string; width: number; height: number } {
  let y = 0
  const nodes: string[] = []
  for (const { entry, hasGap } of run.items) {
    nodes.push(nodeOf(entry, hasTime, y))
    y += (entry.lines.length + (hasGap ? 1 : 0)) * ROW_PX
  }
  const first = run.items[0]?.entry
  const top = run.isStart && first?.side === 'user' ? ROW_PX / 2 : 0
  const width = railCells(hasTime, run.items.some(i => i.entry.isRunning)) * CELL_PX
  const x = railX(hasTime)
  const line = `<rect class="l" x="${px(x - 0.75)}" y="${top}" width="1.5" height="${y - top}"/>`
  return { source: svgOf(width, y, RAIL_STYLE, line + nodes.join('')), width, height: y }
}

/* A day's rule across the body: the day, dim, then a thin line. */
function ruleSvg(day: string, width: number): string {
  const end = textCells(day) * 6.4 + 10
  return svgOf(
    width,
    ROW_PX,
    RULE_STYLE,
    `<text class="t" x="0" y="${ROW_PX / 2 + 4}">${xml(day)}</text><rect class="l" x="${px(end)}" y="${ROW_PX / 2}" width="${px(Math.max(0, width - end))}" height="1"/>`,
  )
}

/* The ✕ closing the preview, a plain Button with no hotkey. */
function closeButton(elements: ElementTable, onClose: () => Promise<void>): RenderElement {
  const { Button } = elements
  return (
    <Button key={PREVIEW_CONTROL} plain dimColor onPress={() => onClose()}>
      ✕
    </Button>
  )
}

/* The preview as on the terminal while it is open, its hotkeys gone, set
   apart from the list in a Box with a rounded, dim border: `Preview` and
   the ✕ closing it on its first row, the cut line a Button expanding it. */
function drawPreview(elements: ElementTable, preview: PreviewView): RenderElement {
  const { Box, Text, Button } = elements
  const body = preview.body
  return (
    <Box key="preview.box" flexDirection="column" borderStyle="round" borderDimColor paddingX={1} marginY={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>{words.preview}</Text>
        {closeButton(elements, preview.onClose)}
      </Box>
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
    RULE_STYLE + '.c{stroke:#d3d2cd;stroke-width:1;stroke-dasharray:3 3}@media (prefers-color-scheme: dark){.c{stroke:#41413e}}',
    `<text class="t" x="0" y="${ROW_PX / 2 + 4}">${xml(label)}</text><line class="c" x1="${px(end)}" y1="${ROW_PX / 2 + 0.5}" x2="${px(width)}" y2="${ROW_PX / 2 + 0.5}"/>`,
  )
}

/* The list's share of a tree's 100,000 serialized characters on the
   desktop: what the drawn part of the list may take. A Turn group of two
   two-line sides costs about 1,100 (its Buttons most of it, the rail run's
   style sheet written once per run), so this draws about 45. The rest stays
   under 30,000: the head and the search row about 2,000, the strip up to
   about 8,000 (120 bars), the preview (its Markdown up to 10,000, its text
   and Buttons) and the notes, with room to spare for the reckoning's error
   and the first run's style sheet. */
export const LIST_BUDGET = 50_000

/* What an element costs serialized beyond its text and Svg source,
   roughly: its type, key and props; a Button's handle too. */
const ELEMENT_CHARS = 70
const BUTTON_CHARS = 130
/* A string as it serializes: quoted, its quotes and backslashes escaped. */
const quoted = (s: string) => JSON.stringify(s).length
/* A rail run's own cost beyond its entries' nodes: the Svg, its style
   sheet, its line, the row and column Boxes. */
const RUN_CHARS = quoted(svgOf(99.9, 999, RAIL_STYLE, '<rect class="l" x="99.9" y="9.5" width="1.5" height="999"/>')) + ELEMENT_CHARS * 3

/* Whether a rail run starts at entry `i`: after a rule, a compaction below
   the entry before, or at a running reply, whose mark widens its rail. */
const startsRun = (entries: readonly Entry[], i: number) => isRuleBefore(entries, i) || entries[i - 1]?.compactionAfter !== undefined || entries[i]?.isRunning === true

/* The characters entry `i` adds to the tree as drawDesktopPane draws it:
   its rules above, its node on the rail (and a run's own cost when one
   starts there, or its share of the runs a long stretch is cut into), its
   lines, its gap and rule after. The run starting the drawn part is not
   reckoned; the budget leaves room for it. */
function entryChars(entries: readonly Entry[], i: number, hasTime: boolean, width: number): number {
  const entry = entries[i]
  if (entry === undefined) return 0
  const rows = entry.lines.length + (entry.gapAfter ? 1 : 0)
  let chars = nodeOf(entry, hasTime, 999).length + (startsRun(entries, i) ? RUN_CHARS : Math.ceil((RUN_CHARS * rows) / RUN_ROWS))
  const rule = dayRuleBefore(entries, i)
  if (rule !== undefined) chars += ELEMENT_CHARS + quoted(ruleSvg(rule, width)) + quoted(rule)
  for (const rule of [entry.compactionBefore, entry.compactionAfter]) {
    if (rule === undefined) continue
    const label = compactionLabel(rule)
    chars += ELEMENT_CHARS + quoted(compactionSvg(label, width)) + quoted(label)
  }
  for (const line of entry.lines) chars += BUTTON_CHARS + quoted(line.text) + (line.aside === undefined ? 0 : ELEMENT_CHARS * 2 + quoted(line.aside))
  if (entry.gapAfter) chars += ELEMENT_CHARS
  return chars
}

/* The list as span.ts measures it on the desktop, for the Layout and the
   body's width in cells. */
export function desktopList(entries: readonly Entry[], layout: Layout, bodyColumns: number): SpanList {
  const hasTime = layout !== 'card'
  const width = Math.round(bodyColumns * CELL_PX)
  return {
    length: entries.length,
    cost: i => entryChars(entries, i, hasTime, width),
    groupOf: i => entries[i]?.groupIndex ?? -1,
  }
}

export function drawDesktopPane(elements: ElementTable, view: DesktopView): RenderElement {
  const { Box, Text, Button } = elements
  const hasSvg = 'Svg' in elements
  const svg = (source: string, alt: string, width: number, height: number) =>
    'Svg' in elements ? <elements.Svg source={source} alt={alt} width={px(width)} height={height} /> : null
  const width = Math.round(view.bodyColumns * CELL_PX)
  /* Native Buttons, the chosen one the primary: one height with the
     Layout's Select. */
  const filters = (
    <Box flexDirection="row" columnGap={1}>
      {FILTERS.map(f => (
        <Button
          key={f.filter === 'all' ? FIRST_CONTROL : `f-${f.filter}`}
          variant={f.filter === view.filter ? 'primary' : 'secondary'}
          onPress={() => view.onFilter(f.filter)}
        >
          {filterLabel(f.filter)}
        </Button>
      ))}
    </Box>
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
      <Box flexDirection="row" alignItems="center" columnGap={1}>
        <Box flexGrow={1} flexShrink={1} minWidth={8}>
          <elements.Input
            key={SEARCH_FIELD}
            placeholder={words.searchPlaceholder}
            value={view.search.query}
            submitLabel={words.searchShow}
            onInput={(value: string) => view.search.onInput(value)}
            onSubmit={(value: string) => view.search.onSubmit(value)}
          />
        </Box>
        {/* The field gives way in a narrow pane; the count and ✕ keep
            their width, on one line. */}
        {view.search.count === undefined && view.search.query === '' ? null : (
          <Box flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
            {matchCount(elements, view.search.count)}
            {view.search.query === '' ? null : (
              <Button key={CLEAR_CONTROL} onPress={() => view.search.onClear()}>
                ✕
              </Button>
            )}
          </Box>
        )}
      </Box>
    ) : null
  const moveButton = (key: string, label: string, move: ListMove) => (
    <Button key={key} plain dimColor onPress={() => move.onPress()}>
      {label}
    </Button>
  )
  const hasTime = view.layout !== 'card'
  /* Not pressable, breaking the rail as the day's rule does. */
  const compactionRow = (rule: CompactionRule) => {
    const label = compactionLabel(rule)
    return hasSvg ? svg(compactionSvg(label, width), label, width, ROW_PX)! : <Text dimColor>{label}</Text>
  }
  /* The preview goes under its group's last drawn entry, or at the top
     when none of it is drawn (left out by the filter or the query). */
  let previewAfter = -1
  if (view.preview !== undefined) for (let i = view.window.start; i < view.window.end; i++) if (view.entries[i]?.groupIndex === view.previewGroup) previewAfter = i
  const preview = view.preview === undefined ? null : drawPreview(elements, view.preview)
  const rows: RenderElement[] = []
  if (preview !== null && previewAfter === -1) rows.push(preview)
  let run: Run | undefined
  const endRun = () => {
    if (run === undefined || run.items.length === 0) return
    const first = run.items[0]!.entry
    const rail = railSvg(run, hasTime)
    rows.push(
      <Box key={`row-${first.key}`} flexDirection="row">
        {svg(rail.source, words.rail, rail.width, rail.height)}
        <Box flexDirection="column" flexShrink={1}>
          {run.items.flatMap(({ entry, hasGap }) => {
            const press = () => view.onPress(entry)
            const line = (text: string, n: number, dim: boolean) => (
              <Button key={n === 0 ? entry.key : `${entry.key}.${n}`} plain dimColor={dim} onPress={press}>
                {text || ' '}
              </Button>
            )
            const lines = entry.lines.map((l, n) =>
              l.aside === undefined ? (
                line(l.text, n, l.dim)
              ) : (
                <Box flexDirection="row" width={view.bodyColumns - RAIL_CELLS} justifyContent="space-between">
                  {line(l.text, n, l.dim)}
                  <Text dimColor>{l.aside}</Text>
                </Box>
              ),
            )
            return hasGap ? [...lines, <Text> </Text>] : lines
          })}
        </Box>
      </Box>,
    )
    run = undefined
  }
  for (let i = view.window.start; i < view.window.end; i++) {
    const entry = view.entries[i]
    if (!entry) continue
    const rule = dayRuleBefore(view.entries, i)
    const isRuled = rule !== undefined || entry.compactionBefore !== undefined
    if (isRuled || entry.isRunning) endRun()
    if (rule !== undefined) rows.push(hasSvg ? svg(ruleSvg(rule, width), rule, width, ROW_PX)! : <Text dimColor>{rule}</Text>)
    if (entry.compactionBefore !== undefined) rows.push(compactionRow(entry.compactionBefore))
    const hasNext = entry.gapAfter && i < view.window.end - 1
    const isBeforeRule = hasNext && isRuleBefore(view.entries, i + 1)
    const hasGap = hasNext && !isBeforeRule && i !== previewAfter
    const height = entry.lines.length + (hasGap ? 1 : 0)
    if (run !== undefined && run.rows + height > RUN_ROWS) endRun()
    run ??= { items: [], isStart: i === view.window.start || isRuled, rows: 0 }
    run.items.push({ entry, hasGap })
    run.rows += height
    if (i === previewAfter) {
      endRun()
      rows.push(preview!)
    } else if (isBeforeRule) {
      endRun()
      rows.push(<Text> </Text>)
    }
    if (entry.compactionAfter !== undefined) {
      endRun()
      rows.push(compactionRow(entry.compactionAfter))
    }
  }
  endRun()
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
          <Box flexDirection="row" justifyContent="space-between">
            {/* Under the cut line's key: the pressed Button stays in the
                tree, so the pane keeps the focus (spec §8). */}
            <Button key={MORE_CONTROL} plain onPress={() => expanded.onBack()}>
              {words.back}
            </Button>
            {closeButton(elements, expanded.onClose)}
          </Box>
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
      <Box flexDirection="column">
        {view.earlier === undefined ? null : moveButton(EARLIER_CONTROL, words.earlierTurns(view.earlier.count), view.earlier)}
        {rows}
        {rows.length === 0 ? null : (
          <Box flexDirection="row" columnGap={3} marginTop={1}>
            {view.later === undefined ? null : moveButton(LATER_CONTROL, words.laterTurns(view.later.count), view.later)}
            <Button key={TOP_CONTROL} plain dimColor onPress={() => view.onTop()}>
              {words.backToTop}
            </Button>
          </Box>
        )}
      </Box>
      {view.alert === undefined ? null : <Text color="warning">{`⚠ ${view.alert.text}`}</Text>}
      {view.why === undefined ? null : <Text dimColor>{view.why}</Text>}
      {strip === null && view.count !== undefined ? <Text dimColor>{words.turns(view.count)}</Text> : null}
    </Box>
  )
}
