/* PROTOTYPE — throwaway. chat-toc wayfinder ticket 05: does the docked TOC pane
   read and behave right? Three layout variants (A 卡片 / B 紧凑 / C 时间轴),
   switch with the footer ‹ › buttons, hotkey v, or `/chat-toc a|b|c`.
   `/chat-toc w 36` reopens at another width; `/chat-toc log` dumps observations.
   No tests, no polish, transcript re-read whole on every change. */
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

type $T = any
const P = 'chat-toc-proto'
const PANE = 'chat-toc'
const cpAtom = atom({ plugin: 'chat-toc-proto', key: 'cp' } as const, -1)
const verAtom = atom({ plugin: 'chat-toc-proto', key: 'ver' } as const, 0)
const closedAtom = atom({ plugin: 'chat-toc-proto', key: 'closed' } as const, false)
const pathAtom = atom({ plugin: 'chat-toc-proto', key: 'path' } as const, '')
const noteAtom = atom({ plugin: 'chat-toc-proto', key: 'note' } as const, '')
const VARIANTS = ['A', 'B', 'C'] as const
const VNAME: Record<string, string> = { A: '卡片', B: '紧凑', C: '时间轴' }
const MAX = 4_000_000

/* ---------- observation log ---------- */
const STAMP = Date.now()
const logLines: string[] = []
let flushing = false
let dirty = false
const stats: Record<string, number> = {}
const bump = (k: string, n = 1) => { stats[k] = (stats[k] ?? 0) + n }
async function flush($: $T) {
  dirty = true
  if (flushing) return
  flushing = true
  while (dirty) {
    dirty = false
    try { await $.fs.write(`${$.plugin.root}/../chat-toc-proto-logs/${STAMP}.jsonl`, logLines.join('\n') + '\n') } catch { }
  }
  flushing = false
}
function log($: $T, o: Record<string, unknown>) { logLines.push(JSON.stringify({ t: Date.now(), ...o })); void flush($) }

/* ---------- transcript model ---------- */
type Group = {
  idx: number
  kind: 'prompt' | 'cmd' | 'bang'
  userUuid: string
  userText: string
  time: string
  uuids: string[]
  toolUuids: string[]
  steps: number
  lastText: string
  lastTextUuid: string | null
  status: 'done' | 'interrupted' | 'error'
}
let groups: Group[] = []
let chain: string[] = []
const order = new Map<string, number>()
const groupOfOrder: number[] = []
const toolIdToUuid = new Map<string, string>()
const siteRows = new Set<string>()
let loadError = ''
let truncated = false
let running = false
let lastSize = -1

const textOf = (c: any): string => typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('\n') : ''

function opener(r: any): Group['kind'] | null {
  if (r.type === 'system' && r.subtype === 'local_command' && String(r.content ?? '').includes('<command-name>')) return 'cmd'
  if (r.type !== 'user' || r.isMeta || r.isCompactSummary || r.isSidechain) return null
  const c = r.message?.content
  if (Array.isArray(c) && c.some((b: any) => b?.type === 'tool_result')) return null
  const t = textOf(c).trim()
  if (t.includes('<command-name>')) return 'cmd'
  if (t.startsWith('<bash-input>')) return 'bang'
  if (/^<(local-command-stdout|local-command-caveat|bash-stdout|bash-stderr|task-notification)/.test(t)) return null
  if (t.startsWith('[Request interrupted by user')) return null
  if (r.origin && r.origin.kind !== 'human') return null
  if (!t && !(Array.isArray(c) && c.some((b: any) => b?.type === 'image'))) return null
  return 'prompt'
}

function userDisplay(kind: Group['kind'], r: any): string {
  const c = r.message?.content
  const t = r.type === 'system' ? String(r.content ?? '') : textOf(c)
  if (kind === 'cmd') {
    const name = /<command-name>([\s\S]*?)<\/command-name>/.exec(t)?.[1]?.trim() ?? ''
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(t)?.[1]?.trim() ?? ''
    return `${name.startsWith('/') ? name : '/' + name}${args ? ' ' + args : ''}`
  }
  if (kind === 'bang') return '!' + (/<bash-input>([\s\S]*?)<\/bash-input>/.exec(t)?.[1]?.trim() ?? '')
  const s = t.replace(/<\/?pasted_content[^>]*>/g, ' ').replace(/```[\s\S]*?```/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/[#*_`>]+/g, '').replace(/\s+/g, ' ').trim()
  if (s) return s
  return Array.isArray(c) && c.some((b: any) => b?.type === 'image') ? '（只有图片）' : ''
}

function fmtTime(ts: string | undefined): string {
  if (!ts) return ''
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ''
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const md = `${d.getMonth() + 1}月${d.getDate()}日`
  return d.getFullYear() === new Date().getFullYear() ? `${md} ${hm}` : `${d.getFullYear()}年${md} ${hm}`
}

function parse(text: string) {
  const byId = new Map<string, any>()
  let leaf: string | null = null
  for (const line of text.split('\n')) {
    if (!line) continue
    let r: any
    try { r = JSON.parse(line) } catch { continue }
    if (!r || typeof r.uuid !== 'string' || r.isSidechain) continue
    byId.set(r.uuid, r)
    if (r.type === 'user' || r.type === 'assistant' || r.type === 'system') leaf = r.uuid
  }
  const back: string[] = []
  const guard = new Set<string>()
  let cur = leaf
  while (cur && byId.has(cur) && !guard.has(cur)) {
    guard.add(cur)
    back.push(cur)
    const r = byId.get(cur)
    cur = r.parentUuid ?? (r.subtype === 'compact_boundary' ? r.logicalParentUuid : null)
  }
  chain = back.reverse()
  order.clear(); groupOfOrder.length = 0; toolIdToUuid.clear(); siteRows.clear()
  const out: Group[] = []
  let g: Group | null = null
  let tail: { uuid: string; mid: string; text: string }[] = []
  const close = () => {
    if (!g) return
    if (tail.length) {
      const mid = tail[tail.length - 1]!.mid
      const parts = tail.filter(x => x.mid === mid)
      g.lastText = parts.map(x => x.text).join(' ').replace(/[#*_`>]+/g, '').replace(/\s+/g, ' ').trim()
      g.lastTextUuid = parts[0]!.uuid
    }
    tail = []
  }
  chain.forEach((id, i) => {
    order.set(id, i)
    const r = byId.get(id)
    if ((r.type === 'user' && opener(r) === 'prompt') || (r.type === 'assistant' && Array.isArray(r.message?.content) && r.message.content.some((b: any) => b?.type === 'text' && String(b.text).trim()))
      || (r.type === 'system' && r.subtype === 'local_command' && /<local-command-stdout>[\s\S]*\S[\s\S]*<\/local-command-stdout>/.test(String(r.content ?? '')))) siteRows.add(id)
    const k = opener(r)
    if (k) {
      close()
      g = { idx: out.length, kind: k, userUuid: id, userText: userDisplay(k, r), time: fmtTime(r.timestamp), uuids: [], toolUuids: [], steps: 0, lastText: '', lastTextUuid: null, status: 'done' }
      out.push(g)
    }
    groupOfOrder[i] = g ? g.idx : -1
    if (!g) return
    g.uuids.push(id)
    if (r.type === 'user' && textOf(r.message?.content).startsWith('[Request interrupted by user')) g.status = 'interrupted'
    if (r.type === 'assistant') {
      if (r.isApiErrorMessage) g.status = 'error'
      else if (g.status === 'error') g.status = 'done'
      const blocks = Array.isArray(r.message?.content) ? r.message.content : []
      for (const b of blocks) {
        if (b?.type === 'tool_use') {
          g.steps++
          tail = []
          if (!g.toolUuids.includes(id)) g.toolUuids.push(id)
          if (b.id) toolIdToUuid.set(b.id, id)
        } else if (b?.type === 'text' && String(b.text).trim()) {
          tail.push({ uuid: id, mid: r.message?.id ?? id, text: b.text })
        }
      }
    }
  })
  close()
  groups = out
}

async function findPath($: $T): Promise<string> {
  const saved = await read($, pathAtom)
  if (saved) return saved
  const id = await $.session.id()
  const r = await $.process.run(['sh', '-c', `ls "$HOME"/.claude/projects/*/${id}.jsonl 2>/dev/null | head -1`])
  return r.stdout.trim()
}

async function load($: $T, why: string) {
  const t0 = Date.now()
  try {
    const path = await findPath($)
    if (!path) { loadError = '还没有 transcript 文件：第一条消息发出后这里显示目录。'; groups = []; poke($); return }
    let st
    try { st = await $.fs.stat(path) } catch { loadError = '还没有 transcript 文件：第一条消息发出后这里显示目录。'; groups = []; poke($); return }
    if (st.size === lastSize && why !== 'force') return
    lastSize = st.size
    let text: string
    if (st.size <= MAX) { text = await $.fs.read(path); truncated = false } else {
      const r = await $.process.run(['tail', '-c', String(MAX - 1), path])
      text = r.stdout.slice(r.stdout.indexOf('\n') + 1)
      truncated = true
    }
    loadError = ''
    parse(text)
    resolveAll()
    log($, { ev: 'load', why, ms: Date.now() - t0, size: st.size, chain: chain.length, groups: groups.length })
  } catch (err: any) {
    loadError = `读不到 transcript：${String(err?.message ?? err).slice(0, 80)}`
    log($, { ev: 'load-error', why, err: loadError })
  }
  recompute($)
  poke($)
}
let loadTimer = false
function loadSoon($: $T, why: string) {
  if (loadTimer) return
  loadTimer = true
  $.clock.after(300, () => { loadTimer = false; void load($, why) })
}

/* ---------- what the transcript drew ---------- */
type OS = { first: number; last: number; of: number } | null | undefined
/* keyed by site instance (component|requestId): one row may be drawn by several sites */
const onScreen = new Map<string, { rid: string; c: string; os: OS; at: number }>()
let cpSrc: 'msg' | 'all' | 'noToolUse' = 'noToolUse'
const counts = (c: string) => cpSrc === 'all' || (cpSrc === 'noToolUse' ? c !== 'ToolUse' : c === 'UserMessage' || c === 'AssistantMessage' || c === 'CommandOutput')
const drawnEver = new Set<string>()
const refused = new Set<string>()
let cp = -1
let pokeQueued = false
function poke($: $T) {
  if (pokeQueued) return
  pokeQueued = true
  $.clock.after(0, () => { pokeQueued = false; update($, verAtom, v => v + 1).catch(() => bump('poke-denied')) })
}

/* A drawn requestId resolves to a chain row lazily, after each load: the
   transcript lags the screen, and a reload redraws before the first load.
   Exact uuid first, then the host's derived ids (`collapsed-<uuid>`, or a uuid
   whose last 12 hex digits are replaced) by their 24-char prefix. */
const drawnRids = new Map<string, string>()
const ridCache = new Map<string, string | null>()
const uuidToRid = new Map<string, string>()
const prefix24 = new Map<string, string | null>()
const resolveStats: Record<string, number> = {}
const ridSamples: string[] = []
function resolve(c: string, rid: string): string | null {
  if (rid === 'placeholder') return null
  const hit = ridCache.get(rid)
  if (hit !== undefined) return hit
  let u: string | null = null
  let how = 'none'
  const body = rid.replace(/^collapsed-/, '')
  if (c === 'ToolUse' && toolIdToUuid.has(rid)) { u = toolIdToUuid.get(rid)!; how = 'toolid' }
  else if (order.has(body)) { u = body; how = 'exact' }
  else { const q = prefix24.get(body.slice(0, 24)); if (q) { u = q; how = 'prefix24' } }
  if (chain.length) {
    ridCache.set(rid, u)
    const k = `${c}:${how}`
    resolveStats[k] = (resolveStats[k] ?? 0) + 1
    if (how !== 'exact' && ridSamples.length < 12) ridSamples.push(`${c}:${how}:${rid.slice(0, 48)}`)
  }
  if (u && (!uuidToRid.has(u) || c !== 'ToolGroup')) uuidToRid.set(u, rid)
  return u
}
function resolveAll() {
  ridCache.clear(); uuidToRid.clear(); drawnEver.clear()
  prefix24.clear()
  for (const u of chain) { const k = u.slice(0, 24); prefix24.set(k, prefix24.has(k) ? null : u) }
  for (const [rid, c] of drawnRids) { const u = resolve(c, rid); if (u) drawnEver.add(u) }
}

/* After a jump the highlight is the jumped-to group, not the view's top: a
   fallback jump centers its row, so the top shows the groups above it. The
   lock holds while the jump's own redraws keep coming (each within 300 ms of
   the last) and lets go at the first view change after that quiet. */
let lock: { g: number; last: number } | null = null
let stale = 0
let lockOn = true
function recompute($: $T) {
  /* The host draws only near the view and unmounts rows without a last
     `null`, so stale "on screen" rows linger where the view used to be. Rows
     truly on screen are contiguous in transcript order: split the live rows
     wherever a drawable row that is not live lies between two of them (one
     reported off screen, drawn and gone, or never drawn), and trust only the
     run holding the latest report. */
  type L = { o: number; os: NonNullable<OS>; at: number }
  const live: L[] = []
  const off: number[] = []
  for (const { rid, c, os, at } of onScreen.values()) {
    if (!counts(c)) continue
    const u = resolve(c, rid); const o = u ? order.get(u) : undefined
    if (o === undefined) continue
    if (os) live.push({ o, os, at }); else if (os === null) off.push(o)
  }
  live.sort((x, y) => x.o - y.o)
  const liveO = new Set(live.map(x => x.o))
  for (const u of drawnEver) { const o = order.get(u); if (o !== undefined && !liveO.has(o)) off.push(o) }
  for (const u of siteRows) { const o = order.get(u); if (o !== undefined && !liveO.has(o)) off.push(o) }
  off.sort((x, y) => x - y)
  const runs: L[][] = []
  for (const x of live) {
    const run = runs[runs.length - 1]
    const prev = run?.[run.length - 1]
    const k = prev ? off.findIndex(o => o > prev.o) : -1
    if (prev && (k < 0 || off[k]! >= x.o)) run!.push(x); else runs.push([x])
  }
  let best: L[] = []
  let latest = -1
  for (const run of runs) for (const x of run) if (x.at > latest) { latest = x.at; best = run }
  let lastDrawn = -1
  for (const u of drawnEver) { const o = order.get(u); if (o !== undefined && o > lastDrawn) lastDrawn = o }
  let n = -1
  const shown = best
  const lastRow = best.find(x => x.o === lastDrawn)
  if (lock) n = lock.g
  else if (lastRow && lastRow.os.last === lastRow.os.of - 1) n = groups.length - 1
  else if (shown.length) n = groupOfOrder[shown[0]!.o] ?? -1
  if (n !== cp) {
    cp = n
    $.clock.after(0, () => { update($, cpAtom, () => n).catch(() => bump('cp-denied')) })
  }
  stale = live.length - best.length
}

/* ---------- pane-side state ---------- */
let top = 0
let paused = false
let hold = false /* test-only: goto keeps the window until a wheel or a jump */
let followedCp = -2
let ringKey: string | undefined
let focused = false
let lastEntries: Entry[] = []
let lastVisible: string[] = []
let bodyRowsSeen = 20
let noteTimer = 0

type Entry = { key: string; g: number; side: 'u' | 'a'; dim: boolean; lines: { pre: string; preColor?: string; text: string; dim?: boolean; bold?: boolean }[] }

/* cell widths */
const wide = (c: number) => c >= 0x1100 && (c <= 0x115f || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1faff) || (c >= 0x20000 && c <= 0x3fffd))
const cells = (s: string) => { let n = 0; for (const ch of s) n += wide(ch.codePointAt(0)!) ? 2 : 1; return n }
function wrapN(s: string, w: number, max: number): string[] {
  w = Math.max(4, w)
  const out: string[] = []
  let cur = ''
  let cw = 0
  for (const ch of s) {
    const c = wide(ch.codePointAt(0)!) ? 2 : 1
    if (cw + c > w) {
      out.push(cur); cur = ''; cw = 0
      if (out.length === max) {
        let l = out[max - 1]!
        while (cells(l) + 1 > w) l = [...l].slice(0, -1).join('')
        out[max - 1] = l + '…'
        return out
      }
    }
    cur += ch; cw += c
  }
  if (cur || !out.length) out.push(cur)
  return out
}
const clip = (s: string, w: number) => wrapN(s, w, 1)[0]!

function agentHead(g: Group, inProgress: boolean): string {
  const st = g.steps ? `${g.steps} 步` : ''
  if (inProgress) return `进行中${st ? ' · ' + st : ''}`
  if (g.status === 'interrupted') return `已中断${st ? ' · ' + st : ''}`
  if (g.status === 'error') return `出错${st ? ' · ' + st : ''}`
  if (!g.lastText) return `${st || '0 步'} · 无文字回复`
  return st
}
const hasAgent = (g: Group, i: number) => g.steps > 0 || !!g.lastText || (running && i === groups.length - 1 && g.kind !== 'bang')

/* where a side jumps: [requestId, block] or null (dimmed) */
function targetOf(g: Group, side: 'u' | 'a'): [string, 'start' | 'center'] | null {
  const cand = (u: string) => !refused.has(u) && (drawnEver.has(u) || siteRows.has(u))
  if (side === 'u') {
    if (g.kind === 'prompt') return refused.has(g.userUuid) ? null : [g.userUuid, 'start']
    const at = order.get(g.userUuid) ?? -1
    const next = chain.slice(at + 1).find(cand)
    if (next) return [next, 'center']
    const prev = chain.slice(0, at).reverse().find(cand)
    return prev ? [prev, 'center'] : null
  }
  if (g.lastTextUuid) return refused.has(g.lastTextUuid) ? null : [g.lastTextUuid, 'start']
  const last = [...g.uuids].reverse().find(u => !refused.has(u) && drawnEver.has(u))
  return last ? [last, 'start'] : null
}

function buildEntries(variant: string, filter: string, w: number): Entry[] {
  const out: Entry[] = []
  groups.forEach((g, i) => {
    const hl = i === cp
    const inProg = running && i === groups.length - 1
    const showU = filter !== 'agent'
    const showA = filter !== 'user' && hasAgent(g, i)
    if (!showU && !showA) return
    if (variant === 'A') {
      const bar = hl ? '▌ ' : '  '
      const pc = hl ? 'cyan' : undefined
      if (showU) out.push({ key: `u${i}`, g: i, side: 'u', dim: !targetOf(g, 'u'), lines: [
        { pre: bar, preColor: pc, text: `你${g.time ? ' · ' + g.time : ''}`, dim: true, bold: hl },
        ...wrapN(g.userText || '（空）', w - 2, 2).map(t => ({ pre: bar, preColor: pc, text: t })),
      ] })
      if (showA) out.push({ key: `a${i}`, g: i, side: 'a', dim: !targetOf(g, 'a'), lines: [
        { pre: bar, preColor: pc, text: '↳ ' + agentHead(g, inProg), dim: true, bold: hl },
        ...(g.lastText ? wrapN(g.lastText, w - 4, 2).map(t => ({ pre: bar + '  ', preColor: pc, text: t })) : []),
      ] })
    } else if (variant === 'B') {
      const mk = hl ? '● ' : '  '
      const pc = hl ? 'cyan' : undefined
      if (showU) {
        const tm = g.time ? g.time.replace(/^.*日 /, '') : ''
        const room = w - 2 - (tm ? cells(tm) + 1 : 0)
        const body = clip('› ' + (g.userText || '（空）'), room)
        out.push({ key: `u${i}`, g: i, side: 'u', dim: !targetOf(g, 'u'), lines: [{ pre: mk, preColor: pc, text: body + ' '.repeat(Math.max(0, room - cells(body))) + (tm ? ' ' + tm : ''), bold: hl }] })
      }
      if (showA) {
        const head = agentHead(g, inProg)
        out.push({ key: `a${i}`, g: i, side: 'a', dim: !targetOf(g, 'a'), lines: [{ pre: mk, preColor: pc, text: clip(`  ⤷ ${head}${head && g.lastText ? ' · ' : ''}${g.lastText}`, w - 2), dim: true }] })
      }
    } else {
      const tm = g.time ? g.time.replace(/^.*日 /, '') : ''
      const gut = hl ? '┃ ' : '│ '
      const pc = hl ? 'cyan' : 'gray'
      if (showU) out.push({ key: `u${i}`, g: i, side: 'u', dim: !targetOf(g, 'u'), lines:
        wrapN(g.userText || '（空）', w - 8, 2).map((t, k) => ({ pre: (k === 0 ? tm.padEnd(5) : '     ') + ' ' + gut, preColor: pc, text: t, bold: hl })) })
      if (showA) {
        const head = agentHead(g, inProg)
        const body = wrapN(`↳ ${head}${head && g.lastText ? ' · ' : ''}${g.lastText}`, w - 8, 2)
        out.push({ key: `a${i}`, g: i, side: 'a', dim: !targetOf(g, 'a'), lines: body.map(t => ({ pre: '      ' + gut, preColor: pc, text: t, dim: true })) })
      }
    }
  })
  return out
}
const sepAfter = (variant: string, e: Entry, next: Entry | undefined) => variant !== 'B' && next !== undefined && next.g !== e.g

async function setNote($: $T, s: string) {
  await update($, noteAtom, () => s)
  const mine = ++noteTimer
  if (s) $.clock.after(5000, () => { if (mine === noteTimer) void update($, noteAtom, () => '') })
}

async function jump($: $T, en: Entry, how: string) {
  const g = groups[en.g]
  if (!g) return
  for (let tries = 0; tries < 3; tries++) {
    const t = targetOf(g, en.side)
    if (!t) {
      log($, { ev: 'jump-dim', key: en.key, how, tries })
      await setNote($, '这一条当前没有显示在对话里，无法跳转')
      poke($)
      return
    }
    const res = await $.ui.scroll({ to: { requestId: uuidToRid.get(t[0]) ?? t[0] }, block: t[1] })
    log($, { ev: 'jump', key: en.key, how, rid: t[0], block: t[1], drawn: drawnEver.has(t[0]), fallback: t[0] !== (en.side === 'u' ? g.userUuid : g.lastTextUuid), res })
    if (!res.deny) { if (lockOn) { lock = { g: en.g, last: Date.now() }; recompute($) } await setNote($, ''); return }
    refused.add(t[0])
  }
  await setNote($, '这一条当前没有显示在对话里，无法跳转')
  poke($)
}

/* step the selection ring one entry, scrolling our window to keep it shown */
async function stepRing($: $T, by: number) {
  const keys = lastEntries.map(e => e.key)
  let i = ringKey ? keys.indexOf(ringKey) : -1
  i = i < 0 ? Math.max(0, keys.indexOf(lastVisible[0] ?? '')) : Math.min(keys.length - 1, Math.max(0, i + by))
  const k = keys[i]
  if (!k) return
  paused = true
  if (!lastVisible.includes(k)) { top = by > 0 ? Math.max(0, i - Math.max(0, lastVisible.length - 2)) : i; poke($) }
  void setNote($, '')
  const r = await $.ui.focus({ requestId: PANE, key: k })
  bump(r.deny ? 'focus-deny' : 'focus-ok')
  if (r.deny) log($, { ev: 'focus-deny', k, r })
}

async function openPane($: $T, asked: boolean, columns?: number) {
  const r = await $.ui.open({ id: PANE, title: '目录', columns: columns ?? 44 })
  log($, { ev: 'open', asked, r })
  if (!r.isPlaced) $.ui.status(`目录等待停靠：终端需全屏且 ≥144 列（${r.reason}）；放宽终端会自动出现，或输入 /chat-toc`)
  else $.ui.status(undefined)
  return r
}

export const register: Register = on => {
  on('classic.SessionStart', async ($, e, next) => {
    const src = (e as any).source
    await update($, pathAtom, () => e.transcript_path ?? '')
    log($, { ev: 'SessionStart', src, path: e.transcript_path })
    if (src === 'clear' || src === 'resume') { lastSize = -1; drawnEver.clear(); drawnRids.clear(); onScreen.clear(); refused.clear(); top = 0; void load($, src) }
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'chat-toc', description: '打开对话目录（原型）', immediate: true } as any)
    log($, { ev: 'session.start' })
    void (async () => {
      await load($, 'start')
      const closed = await read($, closedAtom)
      const panes = await $.ui.panes()
      log($, { ev: 'autoopen?', closed, panes })
      if (!closed && !panes.some((p: any) => p.id === PANE)) await openPane($, false)
    })()
    return next(e)
  })

  on('turn.start', async ($, e, next) => { running = true; poke($); return next(e) })
  on('turn.complete', async ($, e, next) => { running = false; loadSoon($, 'turn'); return next(e) })
  on('session.append', async ($, e, next) => { loadSoon($, 'append'); return next(e) })

  for (const c of ['UserMessage', 'AssistantMessage', 'CommandOutput', 'ToolGroup', 'ToolUse'] as const) {
    (on as any)('ui.render', { component: c }, ($: $T, e: any, next: any) => {
      bump('hook:' + c)
      const rid = e.requestId as string
      if (rid !== 'placeholder') {
        const os = e.props.onScreen as OS
        if (!drawnRids.has(rid)) {
          drawnRids.set(rid, c)
          const u = resolve(c, rid)
          if (u && !drawnEver.has(u)) { drawnEver.add(u); refused.delete(u); poke($) }
        }
        if (os !== undefined && lock) { const now = Date.now(); if (now - lock.last < 300) lock.last = now; else { lock = null; log($, { ev: 'unlock' }) } }
        if (os !== undefined) { onScreen.set(`${c}|${rid}`, { rid, c, os, at: Date.now() }); recompute($) }
      }
      return next(e)
    })
  }

  on('ui.close', async ($, e, next) => {
    const r = await next(e)
    if (e.id === PANE && e.origin.kind === 'person') { await update($, closedAtom, () => true); log($, { ev: 'closed-by-person' }) }
    if (e.id === PANE) $.ui.status(undefined)
    return r
  })

  on('command.run', { command: 'chat-toc' }, async ($, e) => {
    const a = e.args.trim().toLowerCase()
    if (a === 'a' || a === 'b' || a === 'c') { await $.store.set('variant', a.toUpperCase()); poke($); return { text: `变体 ${a.toUpperCase()}（${VNAME[a.toUpperCase()]}）` } }
    const src = /^src\s+(msg|all|notooluse)$/.exec(a)
    if (src) { cpSrc = src[1] === 'notooluse' ? 'noToolUse' : src[1] as any; recompute($); return { text: `Current position 只看：${cpSrc}` } }
    const lk = /^lock\s+(on|off)$/.exec(a)
    if (lk) { lockOn = lk[1] === 'on'; lock = null; recompute($); return { text: `跳转后锁定高亮：${lk[1]}` } }
    const gt = /^goto\s+(\d+)$/.exec(a)
    if (gt) { const i = lastEntries.findIndex(x => x.g === Number(gt[1])); if (i >= 0) { top = i; paused = true; hold = true; poke($) } return { text: `TOC 滚到第 ${gt[1]} 组（条目 ${i}）` } }
    if (a === 'log') {
      const s = { stale, resolveStats, ridSamples, stats, chain: chain.length, groups: groups.length, drawnEver: drawnEver.size, drawnInChain: chain.filter(u => drawnEver.has(u)).length, cpSrc, live: [...onScreen.values()].filter(x => x.os).map(x => { const o = order.get(resolve(x.c, x.rid) ?? ''); return `${x.c}:${x.rid.slice(0, 13)}#${o}g${groupOfOrder[o ?? -1] ?? '?'}` +  ` ${x.os!.first}-${x.os!.last}/${x.os!.of} ${Math.round((Date.now() - x.at) / 1000)}s` }), cp, top, paused, ringKey, truncated, loadError }
      log($, { ev: 'dump', ...s })
      return { text: JSON.stringify(s) }
    }
    const w = /^w\s*(\d+)$/.exec(a)
    await update($, closedAtom, () => false)
    if (w) { await $.ui.close({ id: PANE }).catch(() => undefined); const r = await openPane($, true, Number(w[1])); return { text: `目录宽 ${w[1]}：${JSON.stringify(r)}` } }
    await load($, 'force')
    const r = await openPane($, true)
    return { text: r.isPlaced ? '目录已打开' : `目录未落座：${r.reason}` }
  })

  on('ui.focus', { requestId: PANE }, async ($: $T, e: any, next: any) => {
    const r = await next(e)
    if (!r.deny) { ringKey = e.element; if (e.origin.kind === 'person' && /^[ua]\d+$/.test(e.element ?? '')) paused = true }
    return r
  })

  on('ui.scroll', { requestId: PANE }, async ($: $T, e: any, next: any) => {
    if (e.origin.kind !== 'person') return next(e)
    const arrow = e.pointer === undefined && Math.abs(e.by) === 1
    if (arrow && focused) { await stepRing($, e.by); return {} }
    hold = false
    top = Math.max(0, top + e.by)
    paused = true
    bump('wheel')
    poke($)
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($: $T, e: any) => {
    const t0 = Date.now()
    bump('pane')
    const { Box, Text, Button } = $.ui.resolve(e)
    await read($, verAtom)
    const variant = ((await $.store.get('variant')) as string) ?? 'A'
    const note = await read($, noteAtom)
    const cpv = await read($, cpAtom)
    const filter = ((await $.store.get('filter')) as string) ?? 'all'
    const pr = e.props
    focused = pr.isFocused
    if (e.viewport?.isFullscreen === false || pr.placement === 'inline') {
      $.clock.after(0, () => {
        void $.ui.close({ id: PANE }).catch(() => undefined)
        $.ui.status('目录只停靠在全屏布局的右侧；当前不是全屏（/tui fullscreen 切换后可用 /chat-toc 打开）')
      })
      return <Text dimColor>目录只在全屏布局停靠。</Text>
    }
    const W = pr.bodyColumns
    const rows = pr.scroll.bodyRows
    bodyRowsSeen = rows
    const entries = buildEntries(variant, filter, W)
    lastEntries = entries

    /* follow Current position */
    if (cpv !== followedCp) {
      followedCp = cpv
      paused = hold
    }
    const room = rows - 3
    let maxTop = entries.length
    { let acc = 0; for (let k = entries.length - 1; k >= 0; k--) { acc += entries[k]!.lines.length + (sepAfter(variant, entries[k]!, entries[k + 1]) ? 1 : 0); if (acc > room) break; maxTop = k } }
    if (!paused && cpv >= 0) {
      const first = entries.findIndex(x => x.g === cpv)
      if (first >= 0) {
        if (cpv === groups.length - 1) top = maxTop
        else if (first < top || !lastVisible.includes(entries[first]!.key) || first >= top + Math.max(1, lastVisible.length) - 1) top = Math.max(0, first - 1)
      }
    }
    top = Math.max(0, Math.min(top, maxTop))

    const body: any[] = []
    const vis: string[] = []
    let used = 0
    for (let k = top; k < entries.length; k++) {
      const en = entries[k]!
      const rowH = en.lines.length + (sepAfter(variant, en, entries[k + 1]) ? 1 : 0)
      if (used + en.lines.length > room) break
      vis.push(en.key)
      const kids: any[] = []
      en.lines.forEach((l, j) => {
        kids.push(<Text color={l.preColor} dimColor={!l.preColor}>{l.pre}</Text>)
        kids.push(<Text dimColor={l.dim || en.dim} bold={l.bold && !en.dim}>{l.text + (j < en.lines.length - 1 ? '\n' : '')}</Text>)
      })
      body.push(
        <Box key={`row:${en.key}`}>
          <Button key={en.key} plain dimColor={en.dim} hover={{ inverse: true }} onPress={() => { void jump($, en, 'press') }}>{kids}</Button>
        </Box>,
      )
      used += en.lines.length
      if (rowH > en.lines.length && used < room) { body.push(<Text> </Text>); used++ }
    }
    lastVisible = vis
    while (used < room) { body.push(<Text> </Text>); used++ }

    const fbtn = (k: string, label: string, hk: string) => (
      <Button key={`f:${k}`} plain hotkey={hk} onPress={async () => { await $.store.set('filter', k); top = 0; paused = false; followedCp = -2; poke($) }}>{(filter === k ? '●' : '○') + label}</Button>
    )
    const vi = VARIANTS.indexOf(variant as any)
    const cycle = async (d: number) => { await $.store.set('variant', VARIANTS[(vi + d + 3) % 3]!); poke($) }
    const empty = loadError || (groups.length === 0 ? '还没有对话。' : entries.length === 0 ? (filter === 'agent' ? '还没有 Agent 回复。' : '没有可显示的条目。') : '')
    const tree = (
      <Box flexDirection="column">
        <Box flexDirection="row">
          {fbtn('all', '全部', '1')}<Text> </Text>{fbtn('user', '用户', '2')}<Text> </Text>{fbtn('agent', 'Agent', '3')}
        </Box>
        {empty ? <Text dimColor wrap="wrap">{empty}</Text> : null}
        {body}
        <Text dimColor wrap="truncate-end">{note || (truncated ? '只读了 transcript 最后 4 MB' : ' ')}</Text>
        <Box flexDirection="row">
          <Text color="magenta">原型 </Text>
          <Button key="v:prev" plain onPress={() => cycle(-1)}>‹</Button>
          <Text color="magenta">{` ${variant} ${VNAME[variant]} `}</Text>
          <Button key="v:next" plain hotkey="v" onPress={() => cycle(1)}>›</Button>
          <Text dimColor>{`  cp${cpv}${paused ? ' 暂停' : ''}`}</Text>
        </Box>
        <Text> </Text>
      </Box>
    )
    bump('pane-ms', Date.now() - t0)
    return tree
  })
}
