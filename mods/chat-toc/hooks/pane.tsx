/* Drawing the pane in the terminal: the filter row over its tab rule; the
   entries in the window, each hung on the rail (its time column and rail
   marks as `Text`s) beside a column of `plain` Buttons, one Button per line,
   every line of a side pressing the same jump and lighting up together on
   hover; the footer at the bottom with the count and the Layout Button.
   Button takes only a label on 2.1.287, so each line is one string, and
   every colour beside it is a `Text`'s. */

import type { ElementTable, RenderElement } from 'claude-code'
import { textCells } from './cells'
import { GUTTER, dayRuleBefore, entryRows } from './entries'
import type { Entry } from './entries'
import { FIRST_CONTROL, LAYOUT_CONTROL } from './ring'
import { FILTERS, LAYOUT_HOTKEY, filterLabel, layoutLabel } from './view'
import type { Layout, ViewFilter } from './view'
import type { TocWindow } from './window'

export const PANE_ID = 'chat-toc'
export const PANE_TITLE = '目录'
export const PANE_COLUMNS = 44

export const EMPTY_TEXT = '本会话还没有对话'
/* For a resumed or forked session whose file is not written yet. */
export const NOT_WRITTEN_TEXT = '本会话还没写进 transcript 文件，提交第一条消息后显示目录'

/* 2.1.287 draws the pane's ✕ at the right end of the body's first row: the
   filter row keeps these cells free for it. */
const CLOSE_ROOM = 3

/* The rows an entry takes: its day's rule, its lines, the gap after it. */
export function entryHeight(entries: readonly Entry[], i: number): number {
  return entryRows(entries, i)
}

/* A plain Button with a hotkey draws as `1: label`. */
const controlCells = (label: string) => textCells(`x: ${label}`)

/* The cells between two filter Buttons. */
const FILTER_GAP = 3

/* The head's rows: the filter row, the tab rule, a blank line. */
export const HEAD_ROWS = 3
/* The footer's rows: a rule, then the count or the pause and the Layout Button. */
export const FOOT_ROWS = 2
export const PAUSED_TEXT = '⏸ 暂停跟随'

/* The tab rule under the filter row, as runs: heavy under the chosen
   filter's Button, thin elsewhere, across the body's width. */
export function tabRule(bodyColumns: number, filter: ViewFilter): { text: string; isChosen: boolean }[] {
  let start = 0
  for (const f of FILTERS) {
    const cells = controlCells(filterLabel(f.filter))
    if (f.filter === filter) {
      const end = Math.min(bodyColumns, start + cells)
      return [
        { text: '─'.repeat(start), isChosen: false },
        { text: '━'.repeat(Math.max(0, end - start)), isChosen: true },
        { text: '─'.repeat(Math.max(0, bodyColumns - end)), isChosen: false },
      ].filter(run => run.text !== '')
    }
    start += cells + FILTER_GAP
  }
  return [{ text: '─'.repeat(bodyColumns), isChosen: false }]
}

/* The rail beside each line of an entry: a node `●` on a User input's
   first line, a branch `├╴` on an Agent reply's, the rail `│` beside the
   lines after; when its group is lit, `◉`, `┣╸` and `┃`. A side with no
   Jump target hangs on a hollow mark, `○` or `├┄`. */
export function railOf(entry: Entry, isLit: boolean): string[] {
  const user = entry.isOff ? '○  ' : isLit ? '◉  ' : '●  '
  const agent = entry.isOff ? '├┄ ' : isLit ? '┣╸ ' : '├╴ '
  const first = entry.side === 'user' ? user : agent
  return entry.lines.map((_, n) => (n === 0 ? first : isLit ? '┃  ' : '│  '))
}

/* The time column of the compact and timeline Layouts: `HH:MM` and a space. */
const TIME_COLUMN = 6

/* The time column beside an entry: its time on its first line, blank below. */
export function timeColumnOf(entry: Entry): string {
  return entry.lines.map((_, n) => (n === 0 ? entry.time : '').padEnd(TIME_COLUMN)).join('\n')
}

export type PaneView = {
  entries: readonly Entry[]
  window: TocWindow
  layout: Layout
  filter: ViewFilter
  /* The group the highlight is on; undefined lights none. */
  litGroup: number | undefined
  /* The body's width in cells. */
  bodyColumns: number
  /* One line instead of entries, when there are none to show. */
  notice: string | undefined
  /* A refusal said below the entries, after a ⚠ in the theme's warning
     colour, inverse while it flashes. */
  alert: { text: string; isInverse: boolean } | undefined
  /* Lines below the list: why it is empty or incomplete. */
  why: string | undefined
  /* The Turn groups the list holds, for the footer; undefined says none. */
  count: number | undefined
  /* Whether following the transcript is paused. */
  isPaused: boolean
  /* The body's rows: the footer sits on the last two. */
  bodyRows: number
  onPress: (entry: Entry) => Promise<void>
  onFilter: (filter: ViewFilter) => Promise<void>
  onLayout: () => Promise<void>
}

export function drawPane(elements: ElementTable, view: PaneView): RenderElement {
  const { Box, Text, Button } = elements
  const filters = (
    <Box flexDirection="row" columnGap={FILTER_GAP}>
      {FILTERS.map(f => (
        <Button
          key={f.filter === 'all' ? FIRST_CONTROL : `f-${f.filter}`}
          plain
          hotkey={f.hotkey}
          dimColor={f.filter !== view.filter}
          onPress={() => view.onFilter(f.filter)}
        >
          {filterLabel(f.filter)}
        </Button>
      ))}
    </Box>
  )
  const layoutButton = (
    <Button key={LAYOUT_CONTROL} plain hotkey={LAYOUT_HOTKEY} onPress={() => view.onLayout()}>
      {layoutLabel(view.layout)}
    </Button>
  )
  const head = (
    <Box flexDirection="column">
      <Box flexDirection="row" paddingRight={CLOSE_ROOM}>
        {filters}
      </Box>
      <Box flexDirection="row">
        {tabRule(view.bodyColumns, view.filter).map(run => (
          <Text color={run.isChosen ? 'suggestion' : 'subtle'}>{run.text}</Text>
        ))}
      </Box>
      <Text> </Text>
    </Box>
  )
  const rows: RenderElement[] = []
  let drawnRows = 0
  const hasTimeColumn = view.layout !== 'card'
  const room = view.bodyColumns - GUTTER[view.layout]
  for (let i = view.window.start; i < view.window.end; i++) {
    const entry = view.entries[i]
    if (!entry) continue
    const press = () => view.onPress(entry)
    const hover = { scope: `e-${entry.key}`, color: 'suggestion' }
    const isLit = entry.groupIndex === view.litGroup
    const rule = dayRuleBefore(view.entries, i)
    const isOff = entry.isOff === true
    const rails = railOf(entry, isLit)
    const hasGap = entry.gapAfter && i < view.window.end - 1
    const railTone = (n: number) =>
      isLit ? (
        <Text color="suggestion">{rails[n]}</Text>
      ) : n === 0 && entry.side === 'user' && !isOff ? (
        <Text dimColor>{rails[n]}</Text>
      ) : (
        <Text color="subtle">{rails[n]}</Text>
      )
    const timeColumn = hasTimeColumn ? isLit ? <Text color="suggestion">{timeColumnOf(entry)}</Text> : <Text dimColor>{timeColumnOf(entry)}</Text> : null
    /* The gap goes on with the rail, unless a new day's rule comes next. */
    const gap = !hasGap ? null : dayRuleBefore(view.entries, i + 1) !== undefined ? (
      <Text> </Text>
    ) : (
      <Text color={isLit ? 'suggestion' : 'subtle'}>{(hasTimeColumn ? ' '.repeat(TIME_COLUMN) : '') + (isLit ? '┃' : '│')}</Text>
    )
    const line = (text: string, n: number, dim: boolean) => (
      <Button key={n === 0 ? entry.key : `${entry.key}.${n}`} plain dimColor={dim} hover={hover} onPress={press}>
        {text || ' '}
      </Button>
    )
    rows.push(
      <Box key={`row-${entry.key}`} flexDirection="column">
        {rule === undefined ? null : (
          <Box flexDirection="row">
            <Text color="subtle">{'─ '}</Text>
            <Text dimColor>{rule}</Text>
            <Text color="subtle">{' ' + '─'.repeat(Math.max(0, view.bodyColumns - 3 - textCells(rule)))}</Text>
          </Box>
        )}
        <Box flexDirection="row">
          {timeColumn}
          <Box flexDirection="column">{entry.lines.map((_, n) => railTone(n))}</Box>
          {entry.isRunning ? <Text color="claude">{entry.lines.map((_, n) => (n === 0 ? '◐ ' : '  ')).join('\n')}</Text> : null}
          <Box flexDirection="column">
            {entry.lines.map((l, n) =>
              l.aside === undefined ? (
                line(l.text, n, l.dim)
              ) : (
                <Box flexDirection="row" width={room} justifyContent="space-between">
                  {line(l.text, n, l.dim)}
                  {isLit ? <Text color="suggestion">{l.aside}</Text> : <Text dimColor>{l.aside}</Text>}
                </Box>
              ),
            )}
          </Box>
        </Box>
        {gap}
      </Box>,
    )
    drawnRows += (rule === undefined ? 0 : 1) + entry.lines.length + (hasGap ? 1 : 0)
  }
  const status = view.isPaused ? (
    <Text color="warning">{PAUSED_TEXT}</Text>
  ) : view.count === undefined ? (
    <Text> </Text>
  ) : (
    <Text dimColor>{`${view.count} 轮`}</Text>
  )
  const whyLines = view.why === undefined ? 0 : view.why.split('\n').length
  const used = HEAD_ROWS + (view.notice === undefined ? 0 : 1) + drawnRows + (view.alert === undefined ? 0 : 1) + whyLines + FOOT_ROWS
  const spare = Math.max(0, view.bodyRows - used)
  return (
    <Box flexDirection="column">
      {head}
      {view.notice === undefined ? null : <Text dimColor>{view.notice}</Text>}
      {rows}
      {view.alert === undefined ? null : (
        <Text color="warning" inverse={view.alert.isInverse}>
          {`⚠ ${view.alert.text}`}
        </Text>
      )}
      {view.why === undefined ? null : <Text dimColor>{view.why}</Text>}
      {spare > 0 ? <Box height={spare} /> : null}
      <Text color="subtle">{'─'.repeat(view.bodyColumns)}</Text>
      <Box flexDirection="row" justifyContent="space-between">
        {status}
        {layoutButton}
      </Box>
    </Box>
  )
}
