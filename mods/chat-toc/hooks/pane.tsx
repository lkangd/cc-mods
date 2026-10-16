/* Drawing the pane in the terminal: the filter row over its tab rule; the
   entries in the window, each hung on the rail (its time column and rail
   marks as `Text`s) beside a column of `plain` Buttons, one Button per line,
   every line of a side pressing the same jump and lighting up together on
   hover; the footer at the bottom with the count and the Layout Button.
   Button takes only a label on 2.1.287, so each line is one string, and
   every colour beside it is a `Text`'s. */

import type { ElementTable, RenderElement } from 'claude-code'
import { BAR_ROWS, barKey } from './bars'
import type { Bar } from './bars'
import { textCells } from './cells'
import type { CompactionRule } from './compactions'
import { GUTTER, clockTime, dayRuleBefore, entryRows, isRuleBefore } from './entries'
import type { Entry } from './entries'
import { FIRST_CONTROL, LAYOUT_CONTROL } from './ring'
import { FILTERS, LAYOUT_HOTKEY, filterLabel, layoutLabel } from './view'
import type { Layout, ViewFilter } from './view'
import type { TocWindow } from './window'
import { text as words, turnsAndContextUse } from './text'
import { BACK_CONTROL, EXPAND_HOTKEY, MORE_CONTROL, PREVIEW_CONTROL, PREVIEW_HOTKEY } from './preview'
import { NEXT_ACTION, NEXT_CONTROL, PREVIOUS_ACTION, PREVIOUS_CONTROL } from './walk'
import type { WalkDirection } from './walk'
import type { ExpandedBody, PreviewBody } from './preview'
import { COPY_INPUT_CONTROL, COPY_INPUT_HOTKEY, COPY_TEXT_CONTROL, COPY_TEXT_HOTKEY, REUSE_CONTROL, REUSE_HOTKEY } from './reuse'
import type { CopySide } from './reuse'

export const PANE_ID = 'chat-toc'
export const PANE_COLUMNS = 44

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

/* The head's rows: the filter row, the tab rule. */
export const HEAD_ROWS = 2
/* The footer's rows: a rule, then the count or the pause and the Layout Button. */
export const FOOT_ROWS = 2
/* The search row under the tab rule, always drawn. */
export const SEARCH_ROWS = 1

/* The search row's controls: the `f` Button, the field, the clear mark. */
export const SEARCH_CONTROL = 'search.focus'
export const SEARCH_FIELD = 'search'
export const CLEAR_CONTROL = 'search.clear'
export const SEARCH_HOTKEY = 'f'

/* The search row: the `f` Button moving the keys into the field, the field
   holding the query, while there is a query the count of matches among all
   groups and the ✕ that clears it, then ‹ › walking to the previous or
   next Turn group (walk.ts). */
export type SearchView = {
  query: string
  /* Undefined without a query. */
  count: { matches: number; of: number } | undefined
  onFocusSearch: () => Promise<void>
  onInput: (value: string) => void
  /* Hands back its promise: the host lets the transcript move only
     while the person's submit is under way. */
  onSubmit: (value: string) => Promise<void>
  onClear: () => Promise<void>
  /* Hands back its promise, as `onSubmit` does. */
  onWalk: (direction: WalkDirection) => Promise<void>
}

/* The count of matches after the field while there is a query, dim. */
export function matchCount(elements: ElementTable, count: SearchView['count']): RenderElement | null {
  const { Text } = elements
  return count === undefined ? null : <Text dimColor>{' ' + words.matchCount(count.matches, count.of)}</Text>
}

function drawSearch(elements: ElementTable<'terminal'>, search: SearchView): RenderElement {
  const { Box, Text, Button, Input } = elements
  const hasQuery = search.query !== ''
  return (
    <Box flexDirection="row">
      <Button key={SEARCH_CONTROL} plain hotkey={SEARCH_HOTKEY} onPress={() => search.onFocusSearch()}>
        {words.find}
      </Button>
      <Text> </Text>
      <Box flexGrow={1} flexShrink={1}>
        <Input
          key={SEARCH_FIELD}
          placeholder={words.searchPlaceholder}
          value={search.query}
          submitLabel={words.searchSubmit}
          onInput={(value: string) => search.onInput(value)}
          onSubmit={(value: string) => search.onSubmit(value)}
        />
      </Box>
      {matchCount(elements, search.count)}
      {hasQuery ? <Text> </Text> : null}
      {hasQuery ? (
        <Button key={CLEAR_CONTROL} plain dimColor onPress={() => search.onClear()}>
          ✕
        </Button>
      ) : null}
      <Text> </Text>
      <Button key={PREVIOUS_CONTROL} plain action={PREVIOUS_ACTION} onPress={() => search.onWalk('previous')}>
        ‹
      </Button>
      <Text> </Text>
      <Button key={NEXT_CONTROL} plain action={NEXT_ACTION} onPress={() => search.onWalk('next')}>
        ›
      </Button>
    </Box>
  )
}

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

/* The Buttons on the preview's label rows (reuse.ts), acting on the group
   it shows; each is drawn only when the group offers it. */
export type LabelActions = {
  canReuse: boolean
  canCopyInput: boolean
  canCopyText: boolean
  /* The copy Button that reads `Copied` now. */
  copied: CopySide | undefined
  onReuse: () => Promise<void>
  onCopy: (which: CopySide) => Promise<void>
}

/* A dim label row, `User` or `Agent`, with its Buttons at the right end,
   ` · ` between them; on the desktop, which has no hotkeys, without them. */
export function labelRow(elements: ElementTable, label: string, side: 'user' | 'agent', actions: LabelActions | undefined, hasHotkeys = true): RenderElement {
  const { Box, Text, Button } = elements
  const key = (hotkey: string) => (hasHotkeys ? hotkey : undefined)
  const copy = (which: CopySide, control: string, hotkey: string) => (
    <Button key={control} plain hotkey={key(hotkey)} dimColor={actions?.copied !== which} onPress={() => actions?.onCopy(which) ?? Promise.resolve()}>
      {actions?.copied === which ? words.copied : words.copy}
    </Button>
  )
  const buttons: RenderElement[] = []
  if (side === 'user' && actions?.canReuse)
    buttons.push(
      <Button key={REUSE_CONTROL} plain dimColor hotkey={key(REUSE_HOTKEY)} onPress={() => actions.onReuse()}>
        {words.reuse}
      </Button>,
    )
  if (side === 'user' && actions?.canCopyInput) buttons.push(copy('user', COPY_INPUT_CONTROL, COPY_INPUT_HOTKEY))
  if (side === 'agent' && actions?.canCopyText) buttons.push(copy('agent', COPY_TEXT_CONTROL, COPY_TEXT_HOTKEY))
  if (buttons.length === 0) return <Text dimColor>{label}</Text>
  return (
    <Box flexDirection="row" justifyContent="space-between">
      <Text dimColor>{label}</Text>
      <Box flexDirection="row">{buttons.flatMap((b, n) => (n === 0 ? [b] : [<Text dimColor>{' · '}</Text>, b]))}</Box>
    </Box>
  )
}

/* The preview region over the footer (preview.ts): its rule Button, then
   the group's content when shown. */
export type PreviewView = {
  state: 'shown' | 'hidden' | 'noRoom'
  /* The rows it takes, its rule included. */
  rows: number
  body: PreviewBody | undefined
  /* Undefined draws the label rows bare. */
  actions?: LabelActions | undefined
  onToggle: () => Promise<void>
  onMore: () => Promise<void>
}

/* The region: the rule line with the `p` Button, then the meta line, the
   User input under its label, the last text under its label, the files
   line, blank rows, and the cut line. The last text is a `Markdown`,
   which 2.1.287 draws as 2.1.295 does; its Box clips it at the rows it
   was given. */
function drawPreview(elements: ElementTable, preview: PreviewView, bodyColumns: number): RenderElement {
  const { Box, Text, Button } = elements
  const label = preview.state === 'noRoom' ? words.previewNoRoom : words.preview
  const ruleRest = Math.max(0, bodyColumns - 2 - textCells(`${PREVIEW_HOTKEY}: ${label}`) - 1)
  const rule = (
    <Box flexDirection="row">
      <Text color="subtle">{'─ '}</Text>
      <Button key={PREVIEW_CONTROL} plain hotkey={PREVIEW_HOTKEY} dimColor={preview.state !== 'shown'} onPress={() => preview.onToggle()}>
        {label}
      </Button>
      <Text color="subtle">{' ' + '─'.repeat(ruleRest)}</Text>
    </Box>
  )
  const body = preview.state === 'shown' ? preview.body : undefined
  /* Shown with nothing to show (no match): the region keeps its rows. */
  const empty = preview.state === 'shown' && preview.rows > 1 ? <Box height={preview.rows - 1} /> : null
  if (body === undefined)
    return (
      <Box flexDirection="column">
        {rule}
        {empty}
      </Box>
    )
  return (
    <Box flexDirection="column">
      {rule}
      {previewContent(elements, body, preview.actions, true)}
      {body.more === 0 ? null : (
        <Box flexDirection="row">
          <Text dimColor>{words.moreLines(body.more)}</Text>
          <Button key={MORE_CONTROL} plain hotkey={EXPAND_HOTKEY} dimColor onPress={() => preview.onMore()}>
            {words.expand}
          </Button>
        </Box>
      )}
    </Box>
  )
}

/* The region's content under its rule, down to the blank rows: the meta
   line, the User input under its label, the last text under its label in a
   `Markdown` its Box clips at the rows it was given, the files line. */
export function previewContent(elements: ElementTable, body: PreviewBody, actions: LabelActions | undefined, hasHotkeys: boolean): RenderElement {
  const { Box, Text, Markdown } = elements
  const agent = body.agent
  return (
    <Box flexDirection="column">
      <Text dimColor>{body.meta}</Text>
      {body.user === undefined ? null : labelRow(elements, words.previewUser, 'user', actions, hasHotkeys)}
      {body.user === undefined || body.user.length === 0 ? null : <Text>{body.user.join('\n')}</Text>}
      {agent === undefined ? null : labelRow(elements, words.previewAgent, 'agent', actions, hasHotkeys)}
      {agent === undefined || agent.rows === 0 ? null : (
        <Box height={agent.rows} overflow="hidden" flexDirection="column">
          <Markdown text={agent.text} />
        </Box>
      )}
      {body.files === undefined ? null : <Text dimColor>{body.files}</Text>}
      {body.blank > 0 ? <Box height={body.blank} /> : null}
    </Box>
  )
}

/* The expanded preview (preview.ts): one group whole in the list's place,
   the Back Button at its top. */
export type ExpandedView = {
  body: ExpandedBody
  actions?: LabelActions | undefined
  onBack: () => Promise<void>
}

/* The Back Button, the meta line, the User input under its label, the last
   text in one `Markdown` per part under its label, a line after a part the
   cap cut, then the files one per line under their headings. Drawn uncut:
   the host scrolls the tree. */
function drawExpanded(elements: ElementTable, expanded: ExpandedView): RenderElement {
  const { Box, Button } = elements
  return (
    <Box flexDirection="column">
      <Button key={BACK_CONTROL} plain hotkey={EXPAND_HOTKEY} onPress={() => expanded.onBack()}>
        {words.back}
      </Button>
      {expandedContent(elements, expanded, true)}
    </Box>
  )
}

/* The expanded preview under its Back Button: the meta line, the User
   input under its label, the last text in one `Markdown` per part under
   its label, a line after a part the cap cut, then the files one per line
   under their headings. */
export function expandedContent(elements: ElementTable, expanded: ExpandedView, hasHotkeys: boolean): RenderElement {
  const { Box, Text, Markdown } = elements
  const { body } = expanded
  const files = (heading: string, paths: readonly string[]) =>
    paths.length === 0 ? null : (
      <Box flexDirection="column">
        <Text dimColor>{heading}</Text>
        {paths.map(path => (
          <Text>{path}</Text>
        ))}
      </Box>
    )
  return (
    <Box flexDirection="column">
      <Text dimColor>{body.meta}</Text>
      {labelRow(elements, words.previewUser, 'user', expanded.actions, hasHotkeys)}
      {body.user.parts.map(part => (part === '' ? null : <Text>{part}</Text>))}
      {body.user.cut === undefined ? null : <Text dimColor>{body.user.cut}</Text>}
      {body.agent === undefined ? null : labelRow(elements, words.previewAgent, 'agent', expanded.actions, hasHotkeys)}
      {body.agent === undefined ? null : body.agent.parts.map(part => <Markdown text={part} />)}
      {body.agent?.cut === undefined ? null : <Text dimColor>{body.agent.cut}</Text>}
      {files(words.changedHeading, body.changed)}
      {files(words.readHeading, body.read)}
    </Box>
  )
}

/* A compaction's words, as its rule says them. */
export function compactionLabel(rule: CompactionRule): string {
  return words.compactionRule(rule.trigger === 'auto', rule.count, clockTime(rule.timestamp))
}

/* The gap between the footer's left and the Layout Button. */
const FOOT_GAP = 2

/* The footer's left: the turn count, then the context use as long as it
   fits beside the Layout Button, shorter, else left out. */
export function footerStatus(count: number, percent: number | undefined, bodyColumns: number, layout: Layout): string {
  const room = bodyColumns - FOOT_GAP - controlCells(layoutLabel(layout))
  return turnsAndContextUse(count, percent, status => textCells(status) <= room)
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
  /* The context use, a whole percent; undefined leaves it out. */
  contextPercent: number | undefined
  /* Whether the list starts with the line saying earlier turns are not in
     this session's file. */
  isEarlierElsewhere: boolean
  /* The body's rows: the footer sits on the last two. */
  bodyRows: number
  /* The Minimap's cells; none draws no Minimap. */
  bars: readonly Bar[]
  /* The cells drawn lit: the Current position's, or a query's matches. */
  litBars: ReadonlySet<number>
  /* The times under the cells, and the spaces between them. */
  barLabels: { left: string; right: string; gap: number }
  /* The preview region; undefined draws none. */
  preview: PreviewView | undefined
  /* The expanded preview, drawn in place of the Minimap, the list and the
     region; undefined draws those. */
  expanded?: ExpandedView | undefined
  search: SearchView
  onBar: (cell: number) => Promise<void>
  onPress: (entry: Entry) => Promise<void>
  onFilter: (filter: ViewFilter) => Promise<void>
  onLayout: () => Promise<void>
}

export function drawPane(elements: ElementTable<'terminal'>, view: PaneView): RenderElement {
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
    </Box>
  )
  const status = view.count === undefined ? (
    <Text> </Text>
  ) : (
    <Text dimColor>{footerStatus(view.count, view.contextPercent, view.bodyColumns, view.layout)}</Text>
  )
  const footer = (
    <Box flexDirection="column">
      <Text color="subtle">{'─'.repeat(view.bodyColumns)}</Text>
      <Box flexDirection="row" justifyContent="space-between">
        {status}
        {layoutButton}
      </Box>
    </Box>
  )
  if (view.expanded !== undefined) {
    const spare = Math.max(0, view.bodyRows - HEAD_ROWS - SEARCH_ROWS - view.expanded.body.rows - FOOT_ROWS)
    return (
      <Box flexDirection="column">
        {head}
        {drawSearch(elements, view.search)}
        {drawExpanded(elements, view.expanded)}
        {spare > 0 ? <Box height={spare} /> : null}
        {footer}
      </Box>
    )
  }
  const hasBars = view.bars.length > 0
  const barRows = hasBars ? (
    <Box flexDirection="column">
      <Box flexDirection="row">
        {view.bars.map((bar, cell) => (
          <Button key={barKey(cell)} plain dimColor={!view.litBars.has(cell)} onPress={() => view.onBar(cell)}>
            {bar.glyph}
          </Button>
        ))}
        {view.bars.length < view.bodyColumns ? <Text color="subtle">{'▁'.repeat(view.bodyColumns - view.bars.length)}</Text> : null}
      </Box>
      <Text dimColor>{`${view.barLabels.left}${' '.repeat(view.barLabels.gap)}${view.barLabels.right}` || ' '}</Text>
      <Text> </Text>
    </Box>
  ) : null
  /* A compaction's rule: dashed, breaking the rail, not pressable. */
  const compactionRow = (key: string, rule: CompactionRule) => {
    const label = compactionLabel(rule)
    return (
      <Box key={key} flexDirection="row">
        <Text color="subtle">{'╌ '}</Text>
        <Text dimColor>{label}</Text>
        <Text color="subtle">{' ' + '╌'.repeat(Math.max(0, view.bodyColumns - 3 - textCells(label)))}</Text>
      </Box>
    )
  }
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
    /* The gap goes on with the rail, unless a new day's rule or a
       compaction's comes next. */
    const isRuleNext = isRuleBefore(view.entries, i + 1)
    const gap = !hasGap ? null : isRuleNext ? (
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
        {entry.compactionBefore === undefined ? null : compactionRow(`compaction-${entry.key}`, entry.compactionBefore)}
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
        {entry.compactionAfter === undefined ? null : compactionRow(`compaction-after-${entry.key}`, entry.compactionAfter)}
      </Box>,
    )
    const compactionRows = (entry.compactionBefore === undefined ? 0 : 1) + (entry.compactionAfter === undefined ? 0 : 1)
    drawnRows += (rule === undefined ? 0 : 1) + compactionRows + entry.lines.length + (hasGap ? 1 : 0)
  }
  const whyLines = view.why === undefined ? 0 : view.why.split('\n').length
  const previewRows = view.preview?.rows ?? 0
  const used = HEAD_ROWS + SEARCH_ROWS + (hasBars ? BAR_ROWS : 0) + (view.isEarlierElsewhere ? 1 : 0) + (view.notice === undefined ? 0 : 1) + drawnRows + (view.alert === undefined ? 0 : 1) + whyLines + previewRows + FOOT_ROWS
  const spare = Math.max(0, view.bodyRows - used)
  return (
    <Box flexDirection="column">
      {head}
      {drawSearch(elements, view.search)}
      {barRows}
      {view.isEarlierElsewhere ? <Text dimColor>{words.earlierElsewhere}</Text> : null}
      {view.notice === undefined ? null : <Text dimColor>{view.notice}</Text>}
      {rows}
      {view.alert === undefined ? null : (
        <Text color="warning" inverse={view.alert.isInverse}>
          {`⚠ ${view.alert.text}`}
        </Text>
      )}
      {view.why === undefined ? null : <Text dimColor>{view.why}</Text>}
      {spare > 0 ? <Box height={spare} /> : null}
      {view.preview === undefined ? null : drawPreview(elements, view.preview, view.bodyColumns)}
      {footer}
    </Box>
  )
}
