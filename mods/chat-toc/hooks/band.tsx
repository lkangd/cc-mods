/* The band above the prompt while the pane is not on screen: the plugin's
   name, ‹ › walking to the previous or next Turn group as the pane's do
   (walk.ts), the conversation's counts, a Button that opens the pane, and
   at the far right (DISMISS_RIGHT_SINCE) a ✕ that hides the band for good (`/chat-toc-band`
   brings it back). The name opens the pane too: in the accent where the
   terminal's host draws a Button's Text children (TITLE_PRESS_SINCE), else
   as a label-only Button in the plain colour; the desktop draws a Button's
   label in its own colour whatever its children say, so there it is always
   the label alone. The desktop draws no ‹ ›: it cannot move its transcript.
   What does not fit the band's width is left out, the counts' tail first,
   rather than wrapped. The counts are plain Text: the host inverts any
   Button under the pointer. */

import type { ElementTable, RenderElement, RenderSurface } from 'claude-code'
import { textCells } from './cells'
import { text as words } from './text'
import type { BandCounts, BandPart } from './text'
import { BAND_NEXT, BAND_PREVIOUS, NEXT_ACTION, PREVIOUS_ACTION } from './walk'
import type { WalkDirection } from './walk'

export const BAND_KEY = 'chat-toc-band'
export const BAND_OPEN = 'chat-toc-open'
export const BAND_DISMISS = 'chat-toc-band.dismiss'
export const BAND_NAME = 'chat-toc-band.name'
/* The first host seen to draw a Button's `Text` children on the terminal;
   2.1.287 takes a label alone. */
export const TITLE_PRESS_SINCE = '2.1.303'
/* The first host seen to keep a Button a growing Box pushed to the band's
   right end; 2.1.287 draws it out of sight. Before, the ✕ follows the open. */
export const DISMISS_RIGHT_SINCE = '2.1.295'
/* No ☰ before it: the desktop's font draws it below the letters' middle,
   and the terminal follows. */
export const BAND_TITLE = 'ChatTOC'
/* Whether the person hid the band with its ✕, kept in `$.store` across
   sessions. */
export const BAND_HIDDEN_KEY = 'isBandHidden'

const WALK = '  ‹ ›'
const RULE = '  │  '
const BEFORE_OPEN = '   '
const DISMISS = '✕'
/* The least room left between the open and the ✕. */
const BEFORE_DISMISS = 2
/* A desktop draws a proportional font in a cell grid of its own guessing:
   a few cells are kept free so that the line never wraps. */
const DESKTOP_SLACK = 4

export type BandView = {
  surface: RenderSurface
  /* Cells across the band. */
  columns: number
  /* Undefined until the file is read: no number is shown before it is known. */
  counts: BandCounts | undefined
  /* Whether the terminal's host draws the name's Text inside its Button
     (TITLE_PRESS_SINCE). */
  hasStyledTitle: boolean
  /* Whether the host keeps the ✕ at the far right (DISMISS_RIGHT_SINCE). */
  canPushRight: boolean
  onOpen: () => Promise<void>
  /* Hands back its promise: the host moves the transcript only within the
     person's press. */
  onWalk: (direction: WalkDirection) => Promise<void>
  onDismiss: () => Promise<void>
}

/* What the band draws at `columns`: the most of it that fits on one line.
   The counts shorten first (the context use, then the steps, then all of
   them), then the name goes, then the terminal's ‹ ›; the open and the ✕
   always stay. */
export function bandFit(counts: BandCounts | undefined, columns: number, surface: RenderSurface): { hasTitle: boolean; hasWalk: boolean; counts: BandPart[] } {
  const hasWalk = surface === 'terminal'
  const room = columns - (surface === 'terminal' ? 0 : DESKTOP_SLACK)
  const fixed = textCells(words.bandOpen) + BEFORE_DISMISS + textCells(DISMISS)
  const head = textCells(BAND_TITLE) + (hasWalk ? textCells(WALK) : 0)
  const tries: BandPart[][] =
    counts === undefined
      ? [[]]
      : [
          words.bandCounts(counts),
          words.bandCounts(counts, true),
          words.bandCounts({ turns: counts.turns, steps: counts.steps }),
          words.bandCounts({ turns: counts.turns }),
          [],
        ]
  for (const parts of tries) {
    const middle = parts.length === 0 ? textCells(BEFORE_OPEN) : textCells(RULE) + textCells(parts.map(p => p.text).join('')) + textCells(BEFORE_OPEN)
    if (head + middle + fixed <= room) return { hasTitle: true, hasWalk, counts: parts }
  }
  const walkAlone = textCells(WALK.trimStart()) + textCells(BEFORE_OPEN)
  return { hasTitle: false, hasWalk: hasWalk && walkAlone + fixed <= room, counts: [] }
}

export function drawBand(elements: ElementTable, view: BandView): RenderElement {
  const { Box, Text, Button } = elements
  const fit = bandFit(view.counts, view.columns, view.surface)
  const { hasWalk } = fit
  return (
    <Box key={BAND_KEY} flexDirection="row">
      {fit.hasTitle && view.surface === 'terminal' && view.hasStyledTitle ? (
        <Button key={BAND_NAME} plain label={BAND_TITLE} onPress={() => view.onOpen()}>
          <Text color="claude" bold>
            {BAND_TITLE}
          </Text>
        </Button>
      ) : null}
      {fit.hasTitle && (view.surface !== 'terminal' || !view.hasStyledTitle) ? (
        <Button key={BAND_NAME} plain onPress={() => view.onOpen()}>
          {BAND_TITLE}
        </Button>
      ) : null}
      {hasWalk && fit.hasTitle ? <Text>{'  '}</Text> : null}
      {hasWalk ? (
        <Button key={BAND_PREVIOUS} plain action={PREVIOUS_ACTION} onPress={() => view.onWalk('previous')}>
          ‹
        </Button>
      ) : null}
      {hasWalk ? <Text> </Text> : null}
      {hasWalk ? (
        <Button key={BAND_NEXT} plain action={NEXT_ACTION} onPress={() => view.onWalk('next')}>
          ›
        </Button>
      ) : null}
      {fit.counts.length > 0 ? <Text color="subtle">{RULE}</Text> : null}
      {fit.counts.map(part => (part.isNumber ? <Text bold>{part.text}</Text> : <Text dimColor>{part.text}</Text>))}
      {fit.hasTitle || hasWalk ? <Text>{BEFORE_OPEN}</Text> : null}
      {/* 2.1.287 takes a Button's label alone: one string child. */}
      <Button key={BAND_OPEN} plain hover={{ scope: BAND_OPEN, color: 'suggestion' }} onPress={() => view.onOpen()}>
        {words.bandOpen}
      </Button>
      {view.canPushRight ? <Box flexGrow={1} minWidth={BEFORE_DISMISS} /> : <Text>{' '.repeat(BEFORE_DISMISS)}</Text>}
      <Button key={BAND_DISMISS} plain dimColor onPress={() => view.onDismiss()}>
        {DISMISS}
      </Button>
    </Box>
  )
}
