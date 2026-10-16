/* The band above the prompt while the pane is not on screen: the plugin's
   name, ‹ › stepping to the previous or next Turn group as the pane's do
   (step.ts), the conversation's counts, and a Button that opens the pane.
   The counts are plain Text: the host inverts any Button under the
   pointer. */

import type { ElementTable, RenderElement } from 'claude-code'
import { text as words } from './text'
import type { BandCounts } from './text'
import { BAND_NEXT, BAND_PREVIOUS, NEXT_ACTION, PREVIOUS_ACTION } from './step'
import type { StepDirection } from './step'

export const BAND_KEY = 'chat-toc-band'
export const BAND_OPEN = 'chat-toc-open'
export const BAND_TITLE = '☰ ChatTOC'

export type BandView = {
  /* Undefined until the file is read: no number is shown before it is known. */
  counts: BandCounts | undefined
  onOpen: () => Promise<void>
  /* Hands back its promise: the host moves the transcript only within the
     person's press. */
  onStep: (direction: StepDirection) => Promise<void>
}

export function drawBand(elements: ElementTable, view: BandView): RenderElement {
  const { Box, Text, Button } = elements
  const counts = view.counts === undefined ? [] : words.bandCounts(view.counts)
  return (
    <Box key={BAND_KEY} flexDirection="row">
      <Text color="claude" bold>
        {BAND_TITLE}
      </Text>
      <Text>{'  '}</Text>
      <Button key={BAND_PREVIOUS} plain action={PREVIOUS_ACTION} onPress={() => view.onStep('previous')}>
        ‹
      </Button>
      <Text> </Text>
      <Button key={BAND_NEXT} plain action={NEXT_ACTION} onPress={() => view.onStep('next')}>
        ›
      </Button>
      <Text color="subtle">{'  │  '}</Text>
      {counts.map(part => (part.isNumber ? <Text bold>{part.text}</Text> : <Text dimColor>{part.text}</Text>))}
      {counts.length > 0 ? <Text>{'   '}</Text> : null}
      {/* 2.1.287 takes a Button's label alone: one string child. */}
      <Button key={BAND_OPEN} plain hover={{ scope: BAND_OPEN, color: 'suggestion' }} onPress={() => view.onOpen()}>
        {words.bandOpen}
      </Button>
    </Box>
  )
}
