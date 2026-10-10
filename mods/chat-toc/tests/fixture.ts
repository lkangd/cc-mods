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
  /* Any other row, on the chain. */
  row: (row: Row) => string
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
    return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
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
    row: row => push({ ...base(String(row.type ?? 'user')), ...row }),
    rewindTo: id => {
      parent = id
    },
    jsonl: () => rows.map(r => JSON.stringify(r)).join('\n') + '\n',
  }
  return b
}
