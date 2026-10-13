/* Drawing the pane on Claude Code Desktop and the other remote surfaces,
   which lay out and wrap text themselves: the filters as buttons, the
   chosen one primary; the Layout as a select (a button that cycles it
   where the surface has none); a strip of bars over the list; each side one
   button holding its whole text, beside its time and node; the day's rule,
   the refusal and the count as text. The window over the entries is the
   terminal's, so the tree stays bounded. Buttons take only a label, as
   2.1.287 has them. */

import type { ElementTable, RenderElement } from 'claude-code'
import { dayRuleBefore } from './entries'
import type { Entry } from './entries'
import { MINIMAP_HEIGHT, minimapOf } from './minimap'
import { PAUSED_TEXT } from './pane'
import { FIRST_CONTROL, LAYOUT_CONTROL } from './ring'
import { FILTERS, LAYOUT_NAMES, filterLabel, layoutLabel, layoutOf } from './view'
import type { Layout, ViewFilter } from './view'
import type { TocWindow } from './window'

const LAYOUTS: readonly Layout[] = ['card', 'compact', 'timeline']
/* The most of a side's text a button carries. */
const MOST_TEXT = 300

export type DesktopView = {
  entries: readonly Entry[]
  window: TocWindow
  layout: Layout
  filter: ViewFilter
  litGroup: number | undefined
  /* A side's whole text, unfolded. */
  textOf: (entry: Entry) => string
  /* The steps of each Turn group the list holds, for the strip of bars. */
  steps: readonly number[]
  runningGroup: number | undefined
  notice: string | undefined
  alert: { text: string; isInverse: boolean } | undefined
  why: string | undefined
  count: number | undefined
  isPaused: boolean
  bodyColumns: number
  onPress: (entry: Entry) => Promise<void>
  onFilter: (filter: ViewFilter) => Promise<void>
  onLayout: (layout?: Layout) => Promise<void>
}

const cut = (text: string) => ([...text].length > MOST_TEXT ? [...text].slice(0, MOST_TEXT - 1).join('') + '…' : text)

export function drawDesktopPane(elements: ElementTable, view: DesktopView): RenderElement {
  const { Box, Text, Button } = elements
  const filters = (
    <Box flexDirection="row" gap={1}>
      {FILTERS.map(f => (
        <Button
          key={f.filter === 'all' ? FIRST_CONTROL : `f-${f.filter}`}
          label={filterLabel(f.filter)}
          variant={f.filter === view.filter ? 'primary' : 'secondary'}
          hotkey={f.hotkey}
          onPress={() => view.onFilter(f.filter)}
        />
      ))}
    </Box>
  )
  const layoutControl =
    'Select' in elements ? (
      <elements.Select
        key={LAYOUT_CONTROL}
        label="布局"
        options={LAYOUTS.map(l => ({ value: l, label: LAYOUT_NAMES[l] }))}
        value={view.layout}
        onSelect={value => void view.onLayout(layoutOf(value))}
      />
    ) : (
      <Button key={LAYOUT_CONTROL} label={layoutLabel(view.layout)} variant="secondary" onPress={() => view.onLayout()} />
    )
  const width = Math.max(240, Math.min(900, view.bodyColumns * 8 - 8))
  const strip =
    'Svg' in elements && view.steps.length > 0
      ? (() => {
          const map = minimapOf(view.steps, view.litGroup, view.runningGroup, width)
          return <elements.Svg source={map.source} alt={map.alt} width={width} height={MINIMAP_HEIGHT} />
        })()
      : null
  const rows: RenderElement[] = []
  for (let i = view.window.start; i < view.window.end; i++) {
    const entry = view.entries[i]
    if (!entry) continue
    const isLit = entry.groupIndex === view.litGroup
    const rule = dayRuleBefore(view.entries, i)
    if (rule !== undefined) rows.push(<Text dimColor>{rule}</Text>)
    const time = view.layout === 'card' ? (entry.lines[0]?.aside ?? '') : entry.time
    const node = entry.side === 'user' ? (entry.isOff ? '○' : isLit ? '◉' : '●') : entry.isOff ? '┄' : isLit ? '┣' : '├'
    rows.push(
      <Box key={`row-${entry.key}`} flexDirection="row" gap={1}>
        {isLit ? <Text color="suggestion">{time.padEnd(5)}</Text> : <Text dimColor>{time.padEnd(5)}</Text>}
        {isLit ? <Text color="suggestion">{node}</Text> : <Text dimColor>{node}</Text>}
        {entry.isRunning ? <Text color="claude">◐</Text> : null}
        <Button key={entry.key} label={cut(view.textOf(entry))} dimColor={entry.lines[0]?.dim === true} onPress={() => view.onPress(entry)} />
      </Box>,
    )
  }
  const status = view.isPaused ? (
    <Text color="warning">{PAUSED_TEXT}</Text>
  ) : view.count === undefined ? null : (
    <Text dimColor>{`${view.count} 轮`}</Text>
  )
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        {filters}
        {layoutControl}
      </Box>
      {strip}
      {view.notice === undefined ? null : <Text dimColor>{view.notice}</Text>}
      <Box flexDirection="column">{rows}</Box>
      {view.alert === undefined ? null : <Text color="warning">{`⚠ ${view.alert.text}`}</Text>}
      {view.why === undefined ? null : <Text dimColor>{view.why}</Text>}
      {status}
    </Box>
  )
}
