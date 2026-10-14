/* The band above the prompt while the pane is not on screen: the plugin's
   name, the conversation's counts, and a Button that opens the pane. The
   counts are plain Text: the host inverts any Button under the pointer. */

import type { ElementTable, RenderElement } from 'claude-code'
import { text as words } from './text'
import type { BandCounts } from './text'

export const BAND_KEY = 'chat-toc-band'
export const BAND_OPEN = 'chat-toc-open'
export const BAND_TITLE = '☰ ChatTOC'

export type BandView = {
  /* Undefined until the file is read: no number is shown before it is known. */
  counts: BandCounts | undefined
  onOpen: () => Promise<void>
}

export function drawBand(elements: ElementTable, view: BandView): RenderElement {
  const { Box, Text, Button } = elements
  const counts = view.counts === undefined ? [] : words.bandCounts(view.counts)
  return (
    <Box key={BAND_KEY} flexDirection="row">
      <Text color="claude" bold>
        {BAND_TITLE}
      </Text>
      <Text color="subtle">{'  │  '}</Text>
      {counts.map(part => (part.isNumber ? <Text bold>{part.text}</Text> : <Text dimColor>{part.text}</Text>))}
      {counts.length > 0 ? <Text>{'   '}</Text> : null}
      <Button key={BAND_OPEN} plain onPress={() => view.onOpen()}>
        <Text color="suggestion" hover={{ bold: true, underline: true }}>
          {words.bandOpen}
        </Text>
      </Button>
    </Box>
  )
}
