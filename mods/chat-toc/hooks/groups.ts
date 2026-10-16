/* Turn groups: a User input and what the main agent did from it until the
   next User input. This file holds the rule for which chain rows open a
   group, what the group shows of its User input, and what it counts of its
   Agent reply. */

import type { TranscriptRow } from './transcript'
import { text as words } from './text'
import { newTally, settle, tallyRow, typedPrompt } from './facts'
import type { GroupFacts, Tally } from './facts'

/* How the User input was given: a prompt (text or images), a slash command
   (a prompt-type one or a local one), or a `!` shell command. */
export type InputKind = 'prompt' | 'command' | 'shell'

export type TurnGroup = {
  /* The uuid of the row that opened the group: the User input's row. */
  openerUuid: string
  kind: InputKind
  /* The User input's text as the TOC shows it. */
  userText: string
  /* The User input row's timestamp (UTC ISO), when the row has one. */
  timestamp: string | undefined
  /* Every chain row in the group, opener first. */
  rowUuids: string[]
  /* Whether the file holds an Agent reply for the group: the agent wrote in
     it, or the person interrupted it. A local command, or a shell command
     the agent did no work on, has none; neither has a prompt the file holds
     nothing after yet (a running turn shows one regardless). */
  hasAgentReply: boolean
  /* The main agent's tool calls in the group; a subagent is one. */
  steps: number
  /* The last text the agent wrote after its last tool call, the parts of
     one message joined, and the row its first part is on. */
  reply: { text: string; uuid: string } | undefined
  /* The group's last row the agent wrote. */
  lastAgentUuid: string | undefined
  /* How the group's turn ended as the file has it: an interruption marker
     in the group, or the agent's last row an API error. */
  ending: 'done' | 'interrupted' | 'error'
  /* What the preview, search and Reuse read beyond the entries (facts.ts). */
  facts: GroupFacts
}

type Block = { type?: unknown; text?: unknown }

function blocksOf(content: unknown): Block[] {
  return Array.isArray(content) ? content.filter((b): b is Block => typeof b === 'object' && b !== null) : []
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  return blocksOf(content)
    .filter(b => b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text as string)
    .join('\n')
}

const hasBlock = (content: unknown, type: string) => blocksOf(content).some(b => b.type === type)

/* The text a row carries: a user row's message, a system row's own. */
function rowText(row: TranscriptRow): string {
  return row.type === 'system' ? (typeof row.content === 'string' ? row.content : '') : textOf(row.message?.content)
}

const isCommandText = (text: string) => /^\s*<command-(name|message)>/.test(text) && text.includes('<command-name>')
const isShellText = (text: string) => /^\s*<bash-input>/.test(text)

/* The kind of User input a chain row is, or undefined when the row does not
   open a Turn group: tool results, injected reminders and hook rows
   (`isMeta`), compact summaries, command and shell output, interruptions,
   notifications and anything else nobody typed. */
export function inputKindOf(row: TranscriptRow): InputKind | undefined {
  if (row.type === 'system') return row.subtype === 'local_command' && isCommandText(rowText(row)) ? 'command' : undefined
  if (row.type !== 'user' || row.isMeta || row.isCompactSummary) return undefined
  const content = row.message?.content
  if (hasBlock(content, 'tool_result')) return undefined
  const text = rowText(row)
  if (isShellText(text)) return 'shell'
  if (isCommandText(text)) return 'command'
  if (row.origin?.kind !== 'human') return undefined
  return text.trim() || hasBlock(content, 'image') ? 'prompt' : undefined
}

/* Whether a chain row is the output Claude Code itself gave a local slash
   command or a `!` shell command: the input was answered without the
   model. */
export function isLocalOutput(row: TranscriptRow): boolean {
  if (row.type !== 'user' && row.type !== 'system') return false
  return /^\s*<(local-command-stdout|local-command-stderr|bash-stdout|bash-stderr)>/.test(rowText(row))
}

/* Whether a chain row is a User input that opens a Turn group. */
export function opensGroup(row: TranscriptRow): boolean {
  return inputKindOf(row) !== undefined
}

const tagged = (text: string, tag: string) => new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text)?.[1] ?? ''
const collapse = (text: string) => text.replace(/\s+/g, ' ').trim()

/* Text with what does not read as prose taken out: fenced code, images and
   their `[Image #n]` placeholders, Markdown marks, the tags around pasted
   content; then whitespace collapsed. A text that was nothing but code keeps
   its code. */
export function plainText(text: string): string {
  const prose = text
    .replace(/<\/?pasted_content\b[^>]*>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[Image #\d+\]/g, ' ')
  const plain = prose
    .replace(/```[^\n]*\n?[\s\S]*?(```|$)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]*(#{1,6}|>+|[-*+])[ \t]+/gm, '')
    .replace(/(\*\*|__|~~)(\S(?:[\s\S]*?\S)?)\1/g, '$2')
    .replace(/(^|[^\p{L}\p{N}*_])([*_])([\p{L}\p{N}](?:[^\n*_]*?[\p{L}\p{N}])?)\2(?![\p{L}\p{N}])/gu, '$1$3')
    .replace(/`([^`\n]*)`/g, '$1')
  const shown = collapse(plain)
  if (shown) return shown
  return collapse(prose.replace(/```[^\n]*/g, ' '))
}

/* The User input as the TOC lists it: a slash command as `/name args`, a
   shell command as `!cmd`, a prompt as plain text, or a note that it held
   only images. */
export function userTextOf(row: TranscriptRow, kind: InputKind): string {
  const text = rowText(row)
  if (kind === 'command') {
    const name = tagged(text, 'command-name').trim()
    const args = collapse(tagged(text, 'command-args'))
    return `${name.startsWith('/') ? name : `/${name}`}${args ? ` ${args}` : ''}`
  }
  if (kind === 'shell') return `!${collapse(tagged(text, 'bash-input'))}`
  const shown = plainText(text)
  if (shown) return shown
  return hasBlock(row.message?.content, 'image') ? words.imageOnly : ''
}

const isInterruption = (row: TranscriptRow) => row.type === 'user' && /^\s*\[Request interrupted by user/.test(rowText(row))
const isApiError = (row: TranscriptRow) => (row as { isApiErrorMessage?: unknown }).isApiErrorMessage === true

/* The User input as typed (facts.ts): a command's and a shell command's
   text with their own spacing, a prompt's with code and pasted content; an
   input of only images is empty, its words drawn only at display time. */
function typedInputOf(row: TranscriptRow, kind: InputKind): { text: string; hasImages: boolean } {
  const text = rowText(row)
  const hasImages = hasBlock(row.message?.content, 'image')
  if (kind === 'command') {
    const name = tagged(text, 'command-name').trim()
    const args = tagged(text, 'command-args').trim()
    return { text: `${name.startsWith('/') ? name : `/${name}`}${args ? ` ${args}` : ''}`, hasImages }
  }
  if (kind === 'shell') return { text: `!${tagged(text, 'bash-input').trim()}`, hasImages }
  const typed = typedPrompt(text)
  return { text: typed, hasImages }
}

/* A text block the agent wrote after its latest tool call. */
type Part = { uuid: string; messageId: string; text: string }

/* The group being read: the group, the tool calls counted so far, the
   text since the latest one, the latest message's text whatever came after
   it, and the facts' tally. */
type Open = { group: TurnGroup; toolIds: Set<string>; tail: Part[]; latest: Part[]; tally: Tally; input: { text: string; hasImages: boolean } }

function openGroup(row: TranscriptRow, kind: InputKind): Open {
  const group: TurnGroup = {
    openerUuid: row.uuid,
    kind,
    userText: userTextOf(row, kind),
    timestamp: row.timestamp,
    rowUuids: [],
    hasAgentReply: false,
    steps: 0,
    reply: undefined,
    lastAgentUuid: undefined,
    ending: 'done',
    facts: settle(newTally(), { text: '', hasImages: false }, undefined, undefined),
  }
  return { group, toolIds: new Set(), tail: [], latest: [], tally: newTally(), input: typedInputOf(row, kind) }
}

function addRow(open: Open, row: TranscriptRow): void {
  const { group } = open
  group.rowUuids.push(row.uuid)
  tallyRow(open.tally, row)
  if (isInterruption(row)) {
    group.ending = 'interrupted'
    group.hasAgentReply = true
    return
  }
  if (row.type !== 'assistant') return
  group.hasAgentReply = true
  group.lastAgentUuid = row.uuid
  if (group.ending !== 'interrupted') group.ending = isApiError(row) ? 'error' : 'done'
  const messageId = row.message?.id ?? row.uuid
  blocksOf(row.message?.content).forEach((block, n) => {
    if (block.type === 'tool_use') {
      const id = (block as { id?: unknown }).id
      open.toolIds.add(typeof id === 'string' ? id : `${row.uuid}#${n}`)
      open.tail = []
    } else if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      const part = { uuid: row.uuid, messageId, text: block.text }
      open.tail.push(part)
      if (open.latest[0]?.messageId !== messageId) open.latest = []
      open.latest.push(part)
    }
  })
}

const joined = (parts: readonly Part[]) => (parts.length === 0 ? undefined : parts.map(p => p.text).join('\n'))

function closeGroup(open: Open): void {
  const { group, tail } = open
  group.steps = open.toolIds.size
  const last = tail[tail.length - 1]
  const parts = last === undefined ? [] : tail.filter(p => p.messageId === last.messageId)
  group.facts = settle(open.tally, open.input, joined(parts), joined(open.latest))
  if (!last) return
  group.reply = { text: plainText(joined(parts) ?? ''), uuid: parts[0]?.uuid ?? last.uuid }
}

/* The chain's Turn groups, in order. Rows before the first User input
   belong to no group. */
export function groupTurns(chain: readonly TranscriptRow[]): TurnGroup[] {
  const groups: TurnGroup[] = []
  let open: Open | undefined
  for (const row of chain) {
    const kind = inputKindOf(row)
    if (kind !== undefined) {
      if (open) closeGroup(open)
      open = openGroup(row, kind)
      groups.push(open.group)
    }
    if (open) addRow(open, row)
  }
  if (open) closeGroup(open)
  return groups
}
