/* Drawing the pane: the filter row, then the entries in the window, each a
   row of a gutter `Text` beside a column of `plain` Buttons, one Button per
   line, every line of a side pressing the same jump and lighting up
   together on hover. Button takes only a label on 2.1.287, so each line is
   one string. */

import type { ElementTable, RenderElement } from 'claude-code'
import { textCells } from './cells'
import { GUTTER } from './entries'
import type { Entry } from './entries'
import { FIRST_CONTROL, LAST_CONTROL } from './ring'
import { FILTERS, LAYOUT_HOTKEY, filterLabel, layoutLabel } from './view'
import type { Layout, ViewFilter } from './view'
import type { TocWindow } from './window'

export const PANE_ID = 'chat-toc'
export const PANE_TITLE = '目录'
export const PANE_COLUMNS = 44

export const EMPTY_TEXT = '本会话还没有对话'

/* 2.1.287 draws the pane's ✕ at the right end of the body's first row: the
   filter row keeps these cells free for it. */
const CLOSE_ROOM = 3

/* The rows an entry takes, the blank line after it included. */
export function entryHeight(entries: readonly Entry[], i: number): number {
  const entry = entries[i]
  return entry === undefined ? 0 : entry.lines.length + (entry.gapAfter ? 1 : 0)
}

/* A plain Button with a hotkey draws as `1: label`. */
const controlCells = (label: string) => textCells(`x: ${label}`)

/* The filter row's rows: one, or two when the Layout Button does not fit
   beside the filter at this width, and goes below it. */
export function filterRows(bodyColumns: number, filter: ViewFilter, layout: Layout): number {
  const filters = FILTERS.reduce((n, f) => n + controlCells(filterLabel(f.filter, filter)), 0) + FILTERS.length - 1
  return filters + 1 + controlCells(layoutLabel(layout)) + CLOSE_ROOM <= bodyColumns ? 1 : 2
}

/* The gutter of each line of an entry: in the card a `▌` and in compact a
   `●` when its group is lit, else blank; in the timeline its time, or
   blank, then the rail, `┃` when lit. */
export function gutterOf(entry: Entry, layout: Layout, isLit: boolean): string[] {
  if (layout !== 'timeline') return entry.lines.map(() => (isLit ? (layout === 'card' ? '▌ ' : '● ') : ' '.repeat(GUTTER[layout])))
  const rail = isLit ? '┃' : '│'
  return entry.lines.map((_, n) => `${(n === 0 ? entry.time : '').padEnd(5)} ${rail} `)
}

export type PaneView = {
  entries: readonly Entry[]
  window: TocWindow
  layout: Layout
  filter: ViewFilter
  /* The group the highlight is on; undefined lights none. */
  litGroup: number | undefined
  /* The filter row's rows, as `filterRows` gives them. */
  headRows: number
  /* One line instead of entries, when there are none to show. */
  notice: string | undefined
  /* One line kept below the entries: why the list is empty or incomplete. */
  footer: string | undefined
  onPress: (entry: Entry) => Promise<void>
  onFilter: (filter: ViewFilter) => Promise<void>
  onLayout: () => Promise<void>
}

export function drawPane(elements: ElementTable, view: PaneView): RenderElement {
  const { Box, Text, Button } = elements
  const filters = (
    <Box flexDirection="row" columnGap={1}>
      {FILTERS.map(f => (
        <Button
          key={f.filter === 'all' ? FIRST_CONTROL : `f-${f.filter}`}
          plain
          hotkey={f.hotkey}
          onPress={() => view.onFilter(f.filter)}
        >
          {filterLabel(f.filter, view.filter)}
        </Button>
      ))}
    </Box>
  )
  const layoutButton = (
    <Button key={LAST_CONTROL} plain hotkey={LAYOUT_HOTKEY} onPress={() => view.onLayout()}>
      {layoutLabel(view.layout)}
    </Button>
  )
  const head =
    view.headRows === 1 ? (
      <Box flexDirection="row" justifyContent="space-between" paddingRight={CLOSE_ROOM}>
        {filters}
        {layoutButton}
      </Box>
    ) : (
      <Box flexDirection="column">
        {filters}
        <Box flexDirection="row" justifyContent="flex-end">
          {layoutButton}
        </Box>
      </Box>
    )
  const rows: RenderElement[] = []
  for (let i = view.window.start; i < view.window.end; i++) {
    const entry = view.entries[i]
    if (!entry) continue
    const press = () => view.onPress(entry)
    const hover = { scope: `e-${entry.key}`, inverse: true }
    const isLit = entry.groupIndex === view.litGroup
    const gutter = gutterOf(entry, view.layout, isLit).join('\n')
    rows.push(
      <Box key={`row-${entry.key}`} flexDirection="row">
        {isLit ? <Text color="cyan">{gutter}</Text> : <Text dimColor>{gutter}</Text>}
        <Box flexDirection="column">
          {entry.lines.map((line, n) => (
            <Button key={n === 0 ? entry.key : `${entry.key}.${n}`} plain dimColor={line.dim} hover={hover} onPress={press}>
              {line.text || ' '}
            </Button>
          ))}
        </Box>
      </Box>,
    )
    if (entry.gapAfter && i < view.window.end - 1) rows.push(<Text> </Text>)
  }
  return (
    <Box flexDirection="column">
      {head}
      {view.notice === undefined ? null : <Text dimColor>{view.notice}</Text>}
      {rows}
      {view.footer === undefined ? null : <Text dimColor>{view.footer}</Text>}
    </Box>
  )
}
