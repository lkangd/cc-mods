import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Seen } from '../types'

const PANE = 'probe'
const PER = 12
const page = atom({ plugin: 'rid-probe', key: 'page' } as const, -1)
const last = atom({ plugin: 'rid-probe', key: 'last' } as const, '')

const lines: string[] = []
const STAMP = Date.now()
const seenList: Seen[] = []
const lastOn = new Map<string, string>()
let flushing = false
let dirty = false

async function flush($: any) {
  dirty = true
  if (flushing) return
  flushing = true
  while (dirty) {
    dirty = false
    await $.fs.write(`${$.plugin.root}/../logs/probe-${STAMP}.jsonl`, lines.join('\n') + '\n')
  }
  flushing = false
}

function log($: any, o: Record<string, unknown>) {
  lines.push(JSON.stringify({ t: Date.now(), ...o }))
  void flush($)
}

const short = (s: string, n = 50) => s.replace(/\s+/g, ' ').slice(0, n)

export const register: Register = on => {
  on('classic.SessionStart', async ($, e, next) => {
    log($, { ev: 'SessionStart', source: (e as any).source, transcript: e.transcript_path })
    return next(e)
  })
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'probe', description: 'Open the requestId probe pane', immediate: true } as any)
    log($, { ev: 'session.start' })
    return next(e)
  })
  on('session.end', async ($, e, next) => {
    log($, { ev: 'session.end', reason: e.reason })
    return next(e)
  })
  on('session.append', async ($, e, next) => {
    const m: any = e.message
    log($, { ev: 'append', door: e.door, uuid: e.uuid, agent: e.agentId ?? null, meta: m?.isMeta ?? null, type: m?.type ?? null, mid: m?.message?.id ?? m?.id ?? null, keys: Object.keys(m ?? {}).join(',') })
    return next(e)
  })
  on('session.compact', async ($, e, next) => {
    log($, { ev: 'compact' })
    return next(e)
  })
  for (const c of ['UserMessage', 'AssistantMessage', 'CommandOutput', 'ToolUse', 'ToolResult', 'ToolGroup', 'TurnDuration', 'InfoNotice', 'PromptHint', 'SessionMode', 'ToolProgress'] as const) {
    on('ui.render', { component: c }, async ($, e, next) => {
      const pr: any = e.props
      const os = pr.onScreen === undefined ? 'undef' : pr.onScreen === null ? 'null' : `${pr.onScreen.first}-${pr.onScreen.last}/${pr.onScreen.of}`
      const k = `${c}:${e.requestId}`
      if (!lastOn.has(k)) {
        const preview = c === 'CommandOutput' ? `/${pr.command} ${pr.args} => ${short(pr.text ?? '', 30)}` : c === 'ToolUse' ? `${pr.tool}` : pr.text !== undefined ? short(pr.text) : short(JSON.stringify(pr), 120)
        log($, { ev: 'first', c, id: e.requestId, origin: pr.origin?.kind ?? null, first: pr.isFirstOfReply ?? null, summary: pr.isSummary ?? null, p: preview, rows: e.viewport?.rows ?? null })
        if (c === 'UserMessage' || c === 'AssistantMessage' || c === 'CommandOutput') seenList.push({ id: e.requestId, c, p: short(preview, 24) })
      }
      if (lastOn.get(k) !== os) {
        lastOn.set(k, os)
        log($, { ev: 'on', c, id: e.requestId, os })
      }
      return next(e)
    })
  }
  on('ui.close', async ($, e, next) => {
    log($, { ev: 'close', id: e.id, origin: e.origin.kind })
    return next(e)
  })
  on('command.run', { command: 'probe' }, async ($, e) => {
    const r = await $.ui.open({ id: PANE, title: 'Probe', columns: 46 })
    log($, { ev: 'open', r })
    return { text: `probe ${JSON.stringify(r)}` }
  })
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = seenList
    const pages = Math.max(1, Math.ceil(list.length / PER))
    const p0 = await read($, page)
    const p = p0 < 0 || p0 >= pages ? pages - 1 : p0
    const shown = list.slice(p * PER, p * PER + PER)
    const msg = await read($, last)
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Button key="prev" onPress={() => update($, page, () => Math.max(0, p - 1))}>[prev]</Button>
          <Text> pg{p + 1}/{pages} </Text>
          <Button key="last" onPress={() => update($, page, () => -1 - Math.random())}>[last]</Button>
          <Button key="next" onPress={() => update($, page, () => Math.min(pages - 1, p + 1))}>[next]</Button>
        </Box>
        <Text>{msg}</Text>
        {shown.map((s: Seen, i: number) => {
          const n = p * PER + i
          return (
            <Button key={`j${n}`} onPress={async () => {
              const res = await $.ui.scroll({ to: { requestId: s.id }, block: 'start' })
              log($, { ev: 'jump', n, id: s.id, c: s.c, res })
              await update($, last, () => `j${n} ${JSON.stringify(res)}`)
            }}>{`J${n} ${s.c[0]} ${s.p}`}</Button>
          )
        })}
      </Box>
    )
  })
}
