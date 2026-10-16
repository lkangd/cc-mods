/* Reuse and copy (spec §7): what the preview's label-row Buttons put in
   the composer or on the clipboard for a Turn group, which of them a group
   gets, and how a fill keeps the person's draft. pane.tsx draws the
   Buttons; register.tsx makes the calls, reading the group at the press. */

import type { TurnGroup } from './groups'
import { text as words } from './text'

/* The Buttons' keys and hotkeys: `r` Reuse, `c` copy the User input, `a`
   copy the last text. */
export const REUSE_CONTROL = 'preview.reuse'
export const COPY_INPUT_CONTROL = 'preview.copy.user'
export const COPY_TEXT_CONTROL = 'preview.copy.agent'
export const REUSE_HOTKEY = 'r'
export const COPY_INPUT_HOTKEY = 'c'
export const COPY_TEXT_HOTKEY = 'a'

/* How long a copy Button reads `Copied`. */
export const COPIED_MS = 2_000

export type CopyWhich = 'input' | 'text'

/* What a group's label rows offer: each text undefined draws no Button. */
export type Reusable = {
  /* What `r` fills: the User input as typed. None for a `!cmd` (a fill
     cannot enter bash mode, so Enter would ask the model) or an input of
     only images. */
  fill: string | undefined
  /* What `c` copies: the User input as typed, `!cmd` too. */
  input: string | undefined
  /* What `a` copies: the last text as its Markdown source. None while the
     group runs (it would be half written) or when it ended without text. */
  text: string | undefined
  /* Whether the input held images, which neither a fill nor a copy takes. */
  hasImagesLeft: boolean
}

export function reusableOf(group: TurnGroup, isRunning: boolean): Reusable {
  const { input, hasImages, lastText } = group.facts
  const isImageOnly = group.kind === 'prompt' && hasImages && input === words.imageOnly
  const typed = input === '' || isImageOnly ? undefined : input
  return {
    fill: group.kind === 'shell' ? undefined : typed,
    input: typed,
    text: isRunning || !lastText ? undefined : lastText,
    hasImagesLeft: hasImages && typed !== undefined,
  }
}

/* How a fill goes in: over an empty composer, else after the draft and a
   blank line, so a draft is never lost. */
export function fillOf(draft: string, text: string): { text: string; mode: 'replace' | 'append' } {
  if (draft === '') return { text, mode: 'replace' }
  const gap = draft.endsWith('\n\n') ? '' : draft.endsWith('\n') ? '\n' : '\n\n'
  return { text: gap + text, mode: 'append' }
}
