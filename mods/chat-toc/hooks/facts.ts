/* The facts a Turn group carries beyond what its entries draw, read from
   the same chain rows as the group and held in memory with it, never
   written anywhere: the User input as typed, the files the agent touched,
   how long the model worked, the output tokens it wrote, and its last text
   as Markdown. The preview draws them; search and Reuse read them too.

   A tally is kept while the group's rows are read, then settled when the
   group closes, so a group regrouped from its opener gives the same facts
   as the whole file does. */

import type { TranscriptRow } from './transcript'

export type GroupFacts = {
  /* The User input as typed: a prompt's text with code blocks and pasted
     content as they were (the paste tags and image placeholders gone), a
     slash command as `/name args`, a shell command as `!cmd`; empty for an
     input of only images (`hasImages`), which the preview names in words
     at display time (preview.ts `typedInput`). */
  input: string
  /* Whether the User input held images. */
  hasImages: boolean
  /* Absolute paths in the order first touched: changed by `Edit`, `Write`
     or a Bash command's recorded diff; read by `Read` only. A file both
     read and changed is only under `changed`. */
  changed: string[]
  read: string[]
  /* The sum of the group's `turn_duration` rows' `durationMs`; undefined
     when the file holds none for it. */
  durationMs: number | undefined
  /* The main agent's output tokens, each `message.id` counted once;
     undefined when no row of the group states any. */
  outputTokens: number | undefined
  /* The Agent reply's last text as its Markdown source: the text after
     the last tool call, the parts of one message joined. */
  lastText: string | undefined
  /* The latest text the agent wrote in the group, tool calls after it or
     not: what a running group has written so far. */
  latestText: string | undefined
}

type Block = { type?: unknown; text?: unknown; name?: unknown; input?: unknown }

const blocksOf = (content: unknown): Block[] =>
  Array.isArray(content) ? content.filter((b): b is Block => typeof b === 'object' && b !== null) : []

const CHANGING_TOOLS = new Set(['Edit', 'Write'])

export type Tally = {
  changed: Set<string>
  read: Set<string>
  durationMs: number | undefined
  tokensById: Map<string, number>
}

export function newTally(): Tally {
  return { changed: new Set(), read: new Set(), durationMs: undefined, tokensById: new Map() }
}

const pathOf = (input: unknown): string | undefined => {
  const path = (input as { file_path?: unknown } | null)?.file_path
  return typeof path === 'string' && path !== '' ? path : undefined
}

/* Counts what one row of the group says. */
export function tallyRow(tally: Tally, row: TranscriptRow): void {
  const loose = row as TranscriptRow & { durationMs?: unknown; toolUseResult?: unknown }
  if (row.type === 'system' && row.subtype === 'turn_duration' && typeof loose.durationMs === 'number') {
    tally.durationMs = (tally.durationMs ?? 0) + loose.durationMs
    return
  }
  if (row.type === 'assistant') {
    const message = row.message as { id?: unknown; usage?: { output_tokens?: unknown } } | undefined
    const tokens = message?.usage?.output_tokens
    if (typeof tokens === 'number') tally.tokensById.set(typeof message?.id === 'string' ? message.id : row.uuid, tokens)
    for (const block of blocksOf(row.message?.content)) {
      if (block.type !== 'tool_use' || typeof block.name !== 'string') continue
      const path = pathOf(block.input)
      if (path === undefined) continue
      if (CHANGING_TOOLS.has(block.name)) tally.changed.add(path)
      else if (block.name === 'Read') tally.read.add(path)
    }
    return
  }
  if (row.type === 'user') {
    const files = (loose.toolUseResult as { bashEditDiff?: { changedFiles?: unknown } } | null | undefined)?.bashEditDiff?.changedFiles
    if (Array.isArray(files)) for (const path of files) if (typeof path === 'string' && path !== '') tally.changed.add(path)
  }
}

/* The group's facts once its rows are read. */
export function settle(
  tally: Tally,
  input: { text: string; hasImages: boolean },
  lastText: string | undefined,
  latestText: string | undefined,
): GroupFacts {
  let outputTokens: number | undefined
  for (const n of tally.tokensById.values()) outputTokens = (outputTokens ?? 0) + n
  return {
    input: input.text,
    hasImages: input.hasImages,
    changed: [...tally.changed],
    read: [...tally.read].filter(path => !tally.changed.has(path)),
    durationMs: tally.durationMs,
    outputTokens,
    lastText,
    latestText,
  }
}

/* A prompt's text as typed: the tags around pasted content and the
   `[Image #n]` placeholders taken out, the rest as written. */
export function typedPrompt(text: string): string {
  return text
    .replace(/<\/?pasted_content\b[^>]*>/g, '')
    .replace(/[ \t]*\[Image #\d+\][ \t]*/g, ' ')
    .trim()
}
