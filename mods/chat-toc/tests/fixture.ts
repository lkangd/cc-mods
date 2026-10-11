/* Synthetic transcript rows, shaped as Claude Code writes them to the
   session's .jsonl file. Prompts are made up; no real session content. */

export type Row = Record<string, unknown>

export type Builder = {
  /* A prompt the person typed and submitted. */
  prompt: (text: string, extra?: Row) => string
  /* The model's reply: text and tool calls. */
  reply: (blocks: Row[], extra?: Row) => string
  /* A tool's result, fed back as a user-role row. */
  toolResult: (toolUseId: string) => string
  /* A slash command as a user row: a prompt-type command (`human`, the
     agent works on it) or a local one recorded as a user row (no origin). */
  command: (name: string, args: string, kind?: 'prompt' | 'local') => string
  /* A local slash command as Claude Code 2.1.295 records it: a
     `system/local_command` row, its output another such row. */
  localCommand: (name: string, args: string) => string
  localOutput: (text: string) => string
  /* A `!cmd` shell command and its output. */
  bash: (cmd: string) => string
  bashOutput: (stdout: string) => string
  /* The marker an interrupted turn leaves. */
  interrupt: (forToolUse?: boolean) => string
  /* Any other row, on the chain. */
  row: (row: Row) => string
  /* A compaction as Claude Code records it: a `system/compact_boundary` row
     with no `parentUuid` that names the chain's old tip in
     `logicalParentUuid`, then the summary row. Returns the boundary's uuid. */
  compact: () => string
  /* Moves the chain's tip, as a rewind does, to a row already written. */
  rewindTo: (uuid: string | null) => void
  rows: Row[]
  jsonl: () => string
}

export function transcript(start = Date.UTC(2026, 9, 10, 1, 0, 0)): Builder {
  const rows: Row[] = []
  let parent: string | null = null
  let n = 0
  const uuid = () => {
    n += 1
    /* Numbered at both ends, as real uuids differ in their first 24
       characters too. */
    return `${String(n).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`
  }
  const base = (type: string): Row => {
    const id = uuid()
    const r: Row = {
      parentUuid: parent,
      isSidechain: false,
      type,
      uuid: id,
      timestamp: new Date(start + n * 60_000).toISOString(),
      sessionId: 'synthetic-session',
    }
    parent = id
    return r
  }
  const push = (r: Row) => {
    rows.push(r)
    return r.uuid as string
  }
  const b: Builder = {
    rows,
    prompt: (text, extra) =>
      push({ ...base('user'), message: { role: 'user', content: text }, origin: { kind: 'human' }, promptSource: 'typed', ...extra }),
    reply: (blocks, extra) =>
      push({ ...base('assistant'), message: { id: `msg_${n}`, role: 'assistant', content: blocks }, ...extra }),
    toolResult: toolUseId =>
      push({ ...base('user'), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'ok' }] } }),
    command: (name, args, kind = 'prompt') =>
      push({
        ...base('user'),
        message: {
          role: 'user',
          content:
            kind === 'prompt'
              ? `<command-message>${name}</command-message>\n<command-name>/${name}</command-name>\n<command-args>${args}</command-args>`
              : `<command-name>/${name}</command-name>\n            <command-message>${name}</command-message>\n            <command-args>${args}</command-args>`,
        },
        ...(kind === 'prompt' ? { origin: { kind: 'human' } } : {}),
      }),
    localCommand: (name, args) =>
      push({
        ...base('system'),
        subtype: 'local_command',
        level: 'info',
        isMeta: false,
        content: `<command-name>/${name}</command-name>\n            <command-message>${name}</command-message>\n            <command-args>${args}</command-args>`,
      }),
    localOutput: text =>
      push({ ...base('system'), subtype: 'local_command', level: 'info', isMeta: false, content: `<local-command-stdout>${text}</local-command-stdout>` }),
    bash: cmd => push({ ...base('user'), message: { role: 'user', content: `<bash-input>${cmd}</bash-input>` } }),
    bashOutput: stdout =>
      push({ ...base('user'), message: { role: 'user', content: `<bash-stdout>${stdout}</bash-stdout><bash-stderr></bash-stderr>` } }),
    interrupt: forToolUse =>
      push({
        ...base('user'),
        message: { role: 'user', content: [{ type: 'text', text: forToolUse ? '[Request interrupted by user for tool use]' : '[Request interrupted by user]' }] },
      }),
    row: row => push({ ...base(String(row.type ?? 'user')), ...row }),
    compact: () => {
      const tip = parent
      parent = null
      const boundary = push({
        ...base('system'),
        subtype: 'compact_boundary',
        content: 'Conversation compacted',
        level: 'info',
        isMeta: false,
        logicalParentUuid: tip,
        compactMetadata: { trigger: 'manual', preTokens: 1000 },
      })
      push({
        ...base('user'),
        isCompactSummary: true,
        isVisibleInTranscriptOnly: true,
        message: { role: 'user', content: 'This session is being continued from a previous conversation. Summary: synthetic.' },
      })
      return boundary
    },
    rewindTo: id => {
      parent = id
    },
    jsonl: () => rows.map(r => JSON.stringify(r)).join('\n') + '\n',
  }
  return b
}
