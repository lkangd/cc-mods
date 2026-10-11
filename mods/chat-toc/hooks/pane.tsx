/* Drawing the pane: the entries in the window, each a row of a gutter
   `Text` beside a column of `plain` Buttons, one Button per line, every line
   of a side pressing the same jump and lighting up together on hover. Button
   takes only a label on 2.1.287, so each line is one string. */

import type { ElementTable, RenderElement } from 'claude-code'
import { CARD_GUTTER } from './entries'
import type { Entry } from './entries'
import type { TocWindow } from './window'

export const PANE_ID = 'chat-toc'
export const PANE_TITLE = '目录'
export const PANE_COLUMNS = 44

export const EMPTY_TEXT = '本会话还没有对话'
/* For a resumed or forked session whose file is not written yet. */
export const NOT_WRITTEN_TEXT = '本会话还没写进 transcript 文件，提交第一条消息后显示目录'

/* Whether a blank line follows entry i: one parts each Turn group from the
   next, none parts the two sides of one group. */
function partsAfter(entries: readonly Entry[], i: number): boolean {
  const next = entries[i + 1]
  return next !== undefined && next.groupIndex !== entries[i]?.groupIndex
}

/* The rows an entry takes, the blank line after it included. */
export function entryHeight(entries: readonly Entry[], i: number): number {
  return (entries[i]?.lines.length ?? 0) + (partsAfter(entries, i) ? 1 : 0)
}

export type PaneView = {
  entries: readonly Entry[]
  window: TocWindow
  /* One line instead of entries, when there are none to show. */
  notice: string | undefined
  /* One line kept below the entries: why the list is empty or incomplete. */
  footer: string | undefined
  onPress: (entry: Entry) => Promise<void>
}

export function drawPane(elements: ElementTable, view: PaneView): RenderElement {
  const { Box, Text, Button } = elements
  const rows: RenderElement[] = []
  for (let i = view.window.start; i < view.window.end; i++) {
    const entry = view.entries[i]
    if (!entry) continue
    const press = () => view.onPress(entry)
    const hover = { scope: `e-${entry.key}`, inverse: true }
    rows.push(
      <Box key={`row-${entry.key}`} flexDirection="row">
        <Text>{entry.lines.map(() => ' '.repeat(CARD_GUTTER)).join('\n')}</Text>
        <Box flexDirection="column">
          {entry.lines.map((line, n) => (
            <Button key={n === 0 ? entry.key : `${entry.key}.${n}`} plain dimColor={line.dim} hover={hover} onPress={press}>
              {line.text || ' '}
            </Button>
          ))}
        </Box>
      </Box>,
    )
    if (partsAfter(view.entries, i) && i < view.window.end - 1) rows.push(<Text> </Text>)
  }
  return (
    <Box flexDirection="column">
      {view.notice === undefined ? null : <Text dimColor>{view.notice}</Text>}
      {rows}
      {view.footer === undefined ? null : <Text dimColor>{view.footer}</Text>}
    </Box>
  )
}
