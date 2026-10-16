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

/* The first host whose Claude app shows a fill in its composer every time;
   undefined while none does. The app answers `isFilled: true` while the
   text sometimes never shows (2.1.295), so the desktop offers copy only. */
export const DESKTOP_REUSE_SINCE: string | undefined = undefined

/* A release's numbers: `2.1.300-dev` is 2.1.300. */
const releaseOf = (base: string) => base.split('-')[0]!.split('.').map(n => Number(n) || 0)

function isAtLeast(base: string, since: string): boolean {
  const a = releaseOf(base)
  const b = releaseOf(since)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return true
}

/* Whether the surface offers Reuse: the terminal always; the desktop from
   the host `since` names on (`$.session.version()`'s base), never while it
   names none; the other surfaces never. */
export function hasReuse(surface: string, base: string | undefined, since = DESKTOP_REUSE_SINCE): boolean {
  if (surface === 'terminal') return true
  if (surface !== 'desktop' || since === undefined || base === undefined) return false
  return isAtLeast(base, since)
}

/* How a fill goes in: over an empty composer, else after the draft and a
   blank line, so a draft is never lost. */
export function fillOf(draft: string, text: string): { text: string; mode: 'replace' | 'append' } {
  if (draft === '') return { text, mode: 'replace' }
  const gap = draft.endsWith('\n\n') ? '' : draft.endsWith('\n') ? '\n' : '\n\n'
  return { text: gap + text, mode: 'append' }
}

/* The toast for a fill the box did not take: the engine's own cause, or
   none when a hook refused it. */
export function fillRefusedText(refusal: 'no_composer' | 'dialog' | undefined): string {
  if (refusal === 'dialog') return words.fillDialog
  if (refusal === 'no_composer') return words.fillNoComposer
  return words.fillRefused
}
