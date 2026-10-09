/* PROBE — throwaway. chat-toc wayfinder ticket 12: what does a 20 MB transcript
   cost to read, group, redraw and track? Built from the ticket-05 prototype with
   offset-based chunked reads and timers. Modes come from env:
   TP_PANE naive|cached, TP_CP naive|fast, TP_TRIG events|poll, TP_POLL ms, TP_TAG. */
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

type $T = any
const PANE = 'toc-perf'
const cpAtom = atom({ plugin: 'toc-perf', key: 'cp' } as const, -1)
const verAtom = atom({ plugin: 'toc-perf', key: 'ver' } as const, 0)
const pathAtom = atom({ plugin: 'toc-perf', key: 'path' } as const, '')
const FS_MAX = 4_194_304
const CHUNK = 4_000_000

const T0 = Date.now()
const perf: any = (globalThis as any).performance
const now = (): number => (perf?.now ? perf.now() : Date.now())
const NOW0 = now()
const rnd = (x: number) => Math.round(x * 100) / 100

let PANE_MODE = 'cached'
let CP_MODE = 'fast'
let TRIG = 'events'
let POLL = 300
let TAG = 'x'
let READ = 'dd'
let REB = 'extend'

/* ---------- log ---------- */
const ev: any[] = []
const series: Record<string, number[]> = {}
const cnt: Record<string, number> = {}
const bump = (k: string, n = 1) => { cnt[k] = (cnt[k] ?? 0) + n }
const put = (k: string, v: number) => { (series[k] ??= []).push(rnd(v)) }
const log = (o: Record<string, unknown>) => { ev.push({ t: Date.now() - T0, ...o }) }
function pct(xs: number[], p: number) { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))] }
const summary = (xs: number[] = []) => ({ n: xs.length, p50: pct(xs, 0.5), p95: pct(xs, 0.95), max: xs.length ? Math.max(...xs) : null })

/* ---------- transcript model ---------- */
type Group = {
  idx: number; kind: 'prompt' | 'cmd' | 'bang'; userUuid: string; userText: string; time: string
  uuids: string[]; steps: number; lastText: string; lastTextUuid: string | null; status: 'done' | 'interrupted' | 'error'
}
const byId = new Map<string, any>()
let leaf: string | null = null
let unknown = 0
let groups: Group[] = []
let chain: string[] = []
const order = new Map<string, number>()
const groupOfOrder: number[] = []
const toolIdToUuid = new Map<string, string>()
const siteRows = new Set<string>()
let dataVer = 0
let running = false
let offset = 0
let lastSize = -1
let loadError = ''

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
  return t.replace(/<\/?pasted_content[^>]*>/g, ' ').replace(/```[\s\S]*?```/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/[#*_`>]+/g, '').replace(/\s+/g, ' ').trim()
}

function fmtTime(ts: string | undefined): string {
  if (!ts) return ''
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ''
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function utf8Len(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++ }
    else n += 3
  }
  return n
}

function ingest(text: string) {
  let a = 0
  while (a < text.length) {
    let b = text.indexOf('\n', a)
    if (b < 0) b = text.length
    if (b > a) {
      let r: any
      try { r = JSON.parse(text.slice(a, b)) } catch { unknown++; r = null }
      if (r && typeof r.uuid === 'string' && !r.isSidechain) {
        byId.set(r.uuid, r)
        if (r.type === 'user' || r.type === 'assistant' || r.type === 'system') leaf = r.uuid
      }
    }
    a = b + 1
  }
}

let lastRebuild = ''
/* Walk back from the leaf. When the walk meets the old chain's last row the
   file only grew on the current branch: keep the chain, regroup from the last
   group's opener. Anything else (a rewind's new branch, a /clear) rebuilds. */
function rebuild() {
  const back: string[] = []
  const guard = new Set<string>()
  const oldLeaf = chain.length ? chain[chain.length - 1]! : null
  let cur = leaf
  let joined = false
  while (cur && byId.has(cur) && !guard.has(cur)) {
    if (REB === 'extend' && cur === oldLeaf) { joined = true; break }
    guard.add(cur); back.push(cur)
    const r = byId.get(cur)
    cur = r.parentUuid ?? (r.subtype === 'compact_boundary' ? r.logicalParentUuid : null)
  }
  back.reverse()
  let s = 0
  let out: Group[] = []
  if (joined) {
    lastRebuild = 'extend'
    const last = groups[groups.length - 1]
    s = last ? order.get(last.userUuid)! : chain.length
    out = last ? groups.slice(0, -1) : groups.slice()
    for (const id of back) chain.push(id)
  } else {
    lastRebuild = 'full'
    chain = back
    order.clear(); groupOfOrder.length = 0; toolIdToUuid.clear(); siteRows.clear()
  }
  if (!joined && REB === 'extend' && oldLeaf === null && back.length === 0) lastRebuild = 'none'
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
  for (let i = s; i < chain.length; i++) {
    const id = chain[i]!
    order.set(id, i)
    const r = byId.get(id)
    const k = opener(r)
    if ((r.type === 'user' && k === 'prompt') || (r.type === 'assistant' && Array.isArray(r.message?.content) && r.message.content.some((b: any) => b?.type === 'text' && String(b.text).trim()))
      || (r.type === 'system' && r.subtype === 'local_command' && /<local-command-stdout>[\s\S]*\S[\s\S]*<\/local-command-stdout>/.test(String(r.content ?? '')))) siteRows.add(id)
    if (k) {
      close()
      g = { idx: out.length, kind: k, userUuid: id, userText: userDisplay(k, r), time: fmtTime(r.timestamp), uuids: [], steps: 0, lastText: '', lastTextUuid: null, status: 'done' }
      out.push(g)
    }
    groupOfOrder[i] = g ? g.idx : -1
    if (!g) continue
    g.uuids.push(id)
    if (r.type === 'user' && textOf(r.message?.content).startsWith('[Request interrupted by user')) g.status = 'interrupted'
    if (r.type === 'assistant') {
      if (r.isApiErrorMessage) g.status = 'error'
      for (const b of Array.isArray(r.message?.content) ? r.message.content : []) {
        if (b?.type === 'tool_use') { g.steps++; tail = []; if (b.id) toolIdToUuid.set(b.id, id) }
        else if (b?.type === 'text' && String(b.text).trim()) tail.push({ uuid: id, mid: r.message?.id ?? id, text: b.text })
      }
    }
  }
  close()
  groups = out
  dataVer++
}

async function findPath($: $T): Promise<string> {
  const saved = await read($, pathAtom)
  if (saved) return saved
  const id = await $.session.id()
  const r = await $.process.run(['sh', '-c', `ls "$HOME"/.claude/projects/*/${id}.jsonl 2>/dev/null | head -1`])
  return r.stdout.trim()
}

/* Read from `offset` to `size`: whole-file `fs.read` while the file fits its
   4 MiB cap and nothing is read yet, else `tail | head` chunks cut back to the
   last newline, advancing `offset` by the bytes of the lines kept. */
async function readNew($: $T, path: string, size: number) {
  const m: any = { from: offset, chunks: 0, procMs: [] as number[], ingestMs: 0, bytes: 0, via: '' }
  if (offset === 0 && size <= FS_MAX) {
    const a = now(); const text = await $.fs.read(path); m.procMs.push(rnd(now() - a)); m.via = 'fs'
    const cut = text.lastIndexOf('\n'); const part = text.slice(0, cut + 1)
    const b = now(); ingest(part); m.ingestMs += now() - b
    const n = utf8Len(part); offset += n; m.bytes += n; m.chunks = 1
    return m
  }
  m.via = 'proc'
  while (offset < size) {
    const a = now()
    const r = READ === 'tail'
      ? await $.process.run(['sh', '-c', 'tail -c +"$1" "$2" | head -c "$3"', 'sh', String(offset + 1), path, String(CHUNK)])
      : await $.process.run(['sh', '-c', '{ dd bs=1 skip="$1" count=0 2>/dev/null; head -c "$3"; } < "$2"', 'sh', String(offset), path, String(CHUNK)])
    m.procMs.push(rnd(now() - a)); m.chunks++
    const cut = r.stdout.lastIndexOf('\n')
    if (cut < 0) { m.stuck = true; break }
    const part = r.stdout.slice(0, cut + 1)
    const b = now(); ingest(part); m.ingestMs += now() - b
    const n = utf8Len(part); offset += n; m.bytes += n
    if (r.stdout.length < 100) break
  }
  return m
}

let loading = false
let again = false
let readyLogged = false
async function load($: $T, why: string) {
  if (loading) { again = true; return }
  loading = true
  try {
    do {
      again = false
      const t0 = now()
      const path = await findPath($)
      if (!path) { loadError = 'no transcript yet'; break }
      const s0 = now()
      let st
      try { st = await $.fs.stat(path) } catch { loadError = 'no transcript yet'; break }
      const statMs = now() - s0
      put('statMs', statMs)
      if (st.size === lastSize) { bump('load-same'); break }
      if (st.size < lastSize) { byId.clear(); leaf = null; offset = 0; unknown = 0 }
      lastSize = st.size
      const m = await readNew($, path, st.size)
      const r0 = now(); rebuild(); const rebuildMs = now() - r0
      put(lastRebuild === 'extend' ? 'extendMs' : 'fullRebuildMs', rebuildMs)
      const v0 = now(); resolveAll(); const resolveMs = now() - v0
      const total = now() - t0
      loadError = ''
      const first = m.from === 0
      put(first ? 'firstLoadMs' : 'incLoadMs', total)
      if (!first) { put('incRebuildMs', rebuildMs); put('incReadMs', m.procMs.reduce((x: number, y: number) => x + y, 0)) }
      log({ ev: 'load', why, size: st.size, ...m, ingestMs: rnd(m.ingestMs), statMs: rnd(statMs), rebuildMs: rnd(rebuildMs), how: lastRebuild, resolveMs: rnd(resolveMs), totalMs: rnd(total), rows: byId.size, chain: chain.length, groups: groups.length, unknown })
      recompute($)
      poke($)
    } while (again)
  } catch (err: any) {
    loadError = String(err?.message ?? err).slice(0, 120)
    log({ ev: 'load-error', why, err: loadError })
  } finally { loading = false }
}
let loadTimer = false
function loadSoon($: $T, why: string, ms = 300) {
  bump('trig:' + why)
  if (loadTimer) return
  loadTimer = true
  $.clock.after(ms, () => { loadTimer = false; void load($, why) })
}

/* ---------- what the transcript drew ---------- */
type OS = { first: number; last: number; of: number } | null | undefined
const onScreen = new Map<string, { rid: string; c: string; os: OS; at: number }>()
const counts = (c: string) => c !== 'ToolUse'
const drawnEver = new Set<string>()
const refused = new Set<string>()
let cp = -1
let pokeQueued = false
function poke($: $T) {
  if (pokeQueued) return
  pokeQueued = true
  $.clock.after(0, () => { pokeQueued = false; update($, verAtom, v => v + 1).catch(() => bump('poke-denied')) })
}

const drawnRids = new Map<string, string>()
const ridCache = new Map<string, string | null>()
const uuidToRid = new Map<string, string>()
const prefix24 = new Map<string, string | null>()
function resolve(c: string, rid: string): string | null {
  if (rid === 'placeholder') return null
  const hit = ridCache.get(rid)
  if (hit !== undefined) return hit
  let u: string | null = null
  const body = rid.replace(/^collapsed-/, '')
  if (c === 'ToolUse' && toolIdToUuid.has(rid)) u = toolIdToUuid.get(rid)!
  else if (order.has(body)) u = body
  else { const q = prefix24.get(body.slice(0, 24)); if (q) u = q }
  if (chain.length) ridCache.set(rid, u)
  if (u && (!uuidToRid.has(u) || c !== 'ToolGroup')) uuidToRid.set(u, rid)
  return u
}
let drawable: number[] = [] /* sorted orders of rows that could be on screen (fast mode) */
let drawableDirty = true
let prefixUpTo = 0
function resolveAll() {
  if (lastRebuild === 'extend') {
    for (let i = prefixUpTo; i < chain.length; i++) { const u = chain[i]!; const k = u.slice(0, 24); prefix24.set(k, prefix24.has(k) ? null : u) }
    prefixUpTo = chain.length
    for (const [rid, u] of ridCache) if (u === null) ridCache.delete(rid)
    for (const [rid, c] of drawnRids) { if (ridCache.has(rid)) continue; const u = resolve(c, rid); if (u) drawnEver.add(u) }
    drawableDirty = true
    return
  }
  ridCache.clear(); uuidToRid.clear(); drawnEver.clear(); prefix24.clear()
  for (const u of chain) { const k = u.slice(0, 24); prefix24.set(k, prefix24.has(k) ? null : u) }
  prefixUpTo = chain.length
  for (const [rid, c] of drawnRids) { const u = resolve(c, rid); if (u) drawnEver.add(u) }
  drawableDirty = true
}

let lock: { g: number; last: number } | null = null
type L = { o: number; os: NonNullable<OS>; at: number }

/* The ticket-05 algorithm: `off` is every drawable row not live, searched linearly per live row. */
function cpNaive(): { best: L[]; lastDrawn: number } {
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
  return { best, lastDrawn }
}

/* Same answer: rows reported off screen are dropped from the map, and two
   neighbouring live rows share a run when no drawable row lies strictly
   between them (binary search in a sorted array kept per load/draw). */
let lastDrawnO = -1
function cpFast(): { best: L[]; lastDrawn: number } {
  if (drawableDirty) {
    const s = new Set<number>()
    for (const u of siteRows) { const o = order.get(u); if (o !== undefined) s.add(o) }
    lastDrawnO = -1
    for (const u of drawnEver) { const o = order.get(u); if (o !== undefined) { s.add(o); if (o > lastDrawnO) lastDrawnO = o } }
    drawable = [...s].sort((a, b) => a - b)
    drawableDirty = false
  }
  const live: L[] = []
  for (const { rid, c, os, at } of onScreen.values()) {
    if (!os || !counts(c)) continue
    const u = resolve(c, rid); const o = u ? order.get(u) : undefined
    if (o !== undefined) live.push({ o, os, at })
  }
  live.sort((x, y) => x.o - y.o)
  const above = (v: number) => { let lo = 0, hi = drawable.length; while (lo < hi) { const m = (lo + hi) >> 1; if (drawable[m]! <= v) lo = m + 1; else hi = m } return lo }
  let best: L[] = []
  let cur: L[] = []
  let latest = -1
  let curLatest = -1
  for (let i = 0; i < live.length; i++) {
    const x = live[i]!
    if (i > 0) {
      const k = above(live[i - 1]!.o)
      if (!(k >= drawable.length || drawable[k]! >= x.o)) {
        if (curLatest > latest) { latest = curLatest; best = cur }
        cur = []; curLatest = -1
      }
    }
    cur.push(x); if (x.at > curLatest) curLatest = x.at
  }
  if (curLatest > latest) best = cur
  return { best, lastDrawn: lastDrawnO }
}

function recompute($: $T) {
  const a = now()
  const { best, lastDrawn } = CP_MODE === 'naive' ? cpNaive() : cpFast()
  put('cpMs', now() - a)
  let n = -1
  const lastRow = best.find(x => x.o === lastDrawn)
  if (lock) n = lock.g
  else if (lastRow && lastRow.os.last === lastRow.os.of - 1) n = groups.length - 1
  else if (best.length) n = groupOfOrder[best[0]!.o] ?? -1
  if (n !== cp) {
    cp = n
    $.clock.after(0, () => { update($, cpAtom, () => n).catch(() => bump('cp-denied')) })
  }
}

/* ---------- pane ---------- */
let top = 0
let paused = false
let followedCp = -2
let lastVisible: string[] = []

type Entry = { key: string; g: number; side: 'u' | 'a'; lines: { pre: string; text: string; dim?: boolean }[] }

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

function agentHead(g: Group, inProgress: boolean): string {
  const st = g.steps ? `${g.steps} 步` : ''
  if (inProgress) return `进行中${st ? ' · ' + st : ''}`
  if (g.status === 'interrupted') return `已中断${st ? ' · ' + st : ''}`
  if (g.status === 'error') return `出错${st ? ' · ' + st : ''}`
  if (!g.lastText) return `${st || '0 步'} · 无文字回复`
  return st
}
const hasAgent = (g: Group, i: number) => g.steps > 0 || !!g.lastText || (running && i === groups.length - 1 && g.kind !== 'bang')

/* Layout A (cards) without the highlight: that is drawn per frame. */
const memo = new WeakMap<Group, { key: string; u: Entry; a: Entry }>()
function buildEntries(filter: string, w: number): Entry[] {
  const out: Entry[] = []
  groups.forEach((g, i) => {
    const inProg = running && i === groups.length - 1
    const showU = filter !== 'agent'
    const showA = filter !== 'user' && hasAgent(g, i)
    const key = `${w}|${inProg}|${g.steps}|${g.status}|${g.lastText.length}`
    let m = PANE_MODE === 'cached' ? memo.get(g) : undefined
    if (!m || m.key !== key) {
      m = { key,
        u: { key: `u${i}`, g: i, side: 'u', lines: [
          { pre: '', text: `你${g.time ? ' · ' + g.time : ''}`, dim: true },
          ...wrapN(g.userText || '（空）', w - 2, 2).map(t => ({ pre: '', text: t })),
        ] },
        a: { key: `a${i}`, g: i, side: 'a', lines: [
          { pre: '', text: '↳ ' + agentHead(g, inProg), dim: true },
          ...(g.lastText ? wrapN(g.lastText, w - 4, 2).map(t => ({ pre: '  ', text: t })) : []),
        ] } }
      if (PANE_MODE === 'cached') memo.set(g, m); else bump('memo-off')
    }
    if (showU) out.push(m.u)
    if (showA) out.push(m.a)
  })
  return out
}
let cache: { key: string; entries: Entry[]; firstOfGroup: Map<number, number> } | null = null
function entriesFor(filter: string, w: number) {
  const key = `${dataVer}|${filter}|${w}|${running}`
  if (PANE_MODE === 'cached' && cache && cache.key === key) { bump('cache-hit'); return cache }
  const entries = buildEntries(filter, w)
  const firstOfGroup = new Map<number, number>()
  entries.forEach((e, k) => { if (!firstOfGroup.has(e.g)) firstOfGroup.set(e.g, k) })
  cache = { key, entries, firstOfGroup }
  return cache
}
const sepAfter = (e: Entry, next: Entry | undefined) => next !== undefined && next.g !== e.g

async function jumpTo($: $T, gi: number, side: 'u' | 'a') {
  const g = groups[gi]
  if (!g) return 'no group'
  const t = side === 'u' ? g.userUuid : g.lastTextUuid
  if (!t) return 'no target'
  const a = now()
  const res = await $.ui.scroll({ to: { requestId: uuidToRid.get(t) ?? t }, block: 'start' })
  put('jumpMs', now() - a)
  if (!res.deny) lock = { g: gi, last: Date.now() }
  return JSON.stringify(res)
}

/* cpstress: K stale "on screen" reports spread over the whole chain, as if a
   long scroll left residues behind, plus a live run of 20 rows at the end. */
function cpStress(k: number) {
  const saved = new Map(onScreen)
  const savedDrawn = new Set(drawnEver)
  const sites = [...siteRows]
  const step = Math.max(1, Math.floor(sites.length / k))
  let at = 1
  for (let i = 0; i < sites.length && onScreen.size < saved.size + k; i += step) {
    onScreen.set(`S|${sites[i]}`, { rid: sites[i]!, c: 'AssistantMessage', os: { first: 0, last: 3, of: 4 }, at: at++ })
    drawnEver.add(sites[i]!)
  }
  for (const u of sites.slice(-20)) onScreen.set(`E|${u}`, { rid: u, c: 'UserMessage', os: { first: 0, last: 1, of: 2 }, at: at++ })
  drawableDirty = true
  const res: Record<string, unknown> = { k, onScreen: onScreen.size, drawable: siteRows.size + drawnEver.size }
  for (const mode of ['naive', 'fast']) {
    const xs: number[] = []
    let pick = -1
    for (let r = 0; r < 30; r++) {
      if (mode === 'fast') drawableDirty = r === 0
      const a = now(); const o = mode === 'naive' ? cpNaive() : cpFast(); xs.push(rnd(now() - a))
      pick = o.best.length ? (groupOfOrder[o.best[0]!.o] ?? -1) : -1
    }
    res[mode] = { ...summary(xs), firstWithBuild: xs[0], group: pick }
  }
  onScreen.clear(); for (const [k2, v] of saved) onScreen.set(k2, v)
  drawnEver.clear(); for (const u of savedDrawn) drawnEver.add(u)
  drawableDirty = true
  return res
}

function paneStress(w: number) {
  const res: Record<string, unknown> = {}
  for (const f of ['all', 'user', 'agent']) {
    const xs: number[] = []
    for (let r = 0; r < 10; r++) { const a = now(); buildEntries(f, w); xs.push(rnd(now() - a)) }
    res[f] = summary(xs)
  }
  return res
}

export const register: Register = on => {
  on('classic.SessionStart', async ($, e, next) => {
    await update($, pathAtom, () => e.transcript_path ?? '')
    log({ ev: 'SessionStart', src: (e as any).source })
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    PANE_MODE = (await $.env.get('TP_PANE')) || PANE_MODE
    CP_MODE = (await $.env.get('TP_CP')) || CP_MODE
    TRIG = (await $.env.get('TP_TRIG')) || TRIG
    POLL = Number((await $.env.get('TP_POLL')) || POLL)
    TAG = (await $.env.get('TP_TAG')) || TAG
    READ = (await $.env.get('TP_READ')) || READ
    REB = (await $.env.get('TP_REB')) || REB
    log({ ev: 'session.start', sinceModule: Date.now() - T0, perfNow: !!perf?.now, PANE_MODE, CP_MODE, TRIG, POLL, TAG, READ, REB })
    await $.command.register({ name: 'tperf', description: 'toc-perf probe', immediate: true } as any)
    void (async () => {
      await load($, 'start')
      const r = await $.ui.open({ id: PANE, title: '目录', columns: 44 })
      log({ ev: 'open', r })
    })()
    if (TRIG === 'poll') $.clock.every(POLL, () => { void load($, 'poll') })
    return next(e)
  })

  on('turn.start', async ($, e, next) => { running = true; poke($); return next(e) })
  on('turn.complete', async ($, e, next) => { running = false; loadSoon($, 'turn'); return next(e) })
  on('session.append', async ($, e: any, next) => {
    const r = await next(e)
    if (!e.agentId) { log({ ev: 'append', uuid: e.uuid, door: e.door }); loadSoon($, 'append') }
    return r
  })

  for (const c of ['UserMessage', 'AssistantMessage', 'CommandOutput', 'ToolGroup', 'ToolUse'] as const) {
    (on as any)('ui.render', { component: c }, ($: $T, e: any, next: any) => {
      const a = now()
      bump('hook:' + c)
      const rid = e.requestId as string
      if (rid !== 'placeholder') {
        const os = e.props.onScreen as OS
        if (!drawnRids.has(rid)) {
          drawnRids.set(rid, c)
          const u = resolve(c, rid)
          if (u && !drawnEver.has(u)) { drawnEver.add(u); refused.delete(u); drawableDirty = true }
        }
        if (os !== undefined && lock) { const t = Date.now(); if (t - lock.last < 300) lock.last = t; else lock = null }
        if (os !== undefined) {
          const key = `${c}|${rid}`
          if (os === null && CP_MODE === 'fast') onScreen.delete(key)
          else onScreen.set(key, { rid, c, os, at: Date.now() })
          recompute($)
        }
      }
      put('hookMs', now() - a)
      return next(e)
    })
  }

  on('command.run', { command: 'tperf' }, async ($, e) => {
    const a = e.args.trim().split(/\s+/)
    if (a[0] === 'dump') {
      const sig = () => groups.map(g => `${g.userUuid}:${g.steps}:${g.status}:${g.lastTextUuid}:${g.userText}`).join('|')
      const before = sig(); const nBefore = groups.length; const saveReb = REB; REB = 'full'; rebuild(); resolveAll(); REB = saveReb
      log({ ev: 'verify', sameAsFull: before === sig(), groups: nBefore })
      const out = { T0, tag: TAG, modes: { PANE_MODE, CP_MODE, TRIG, POLL, READ, REB }, cnt, summary: Object.fromEntries(Object.entries(series).map(([k, v]) => [k, summary(v)])), series, ev,
        state: { rows: byId.size, chain: chain.length, groups: groups.length, offset, lastSize, unknown, onScreen: onScreen.size, drawnEver: drawnEver.size, siteRows: siteRows.size, cp } }
      const name = `${$.plugin.root}/../logs/${TAG}-${Date.now()}.json`
      await $.fs.write(name, JSON.stringify(out))
      return { text: `TPDUMP ${name}` }
    }
    if (a[0] === 'jump') return { text: 'TPJUMP ' + await jumpTo($, Number(a[1] ?? 0), (a[2] as any) ?? 'u') }
    if (a[0] === 'cpstress') { const r = cpStress(Number(a[1] ?? 3000)); log({ ev: 'cpstress', ...r }); return { text: 'TPCP ' + JSON.stringify(r) } }
    if (a[0] === 'panestress') { const r = paneStress(Number(a[1] ?? 42)); log({ ev: 'panestress', ...r }); return { text: 'TPPANE ' + JSON.stringify(r) } }
    if (a[0] === 'reload') { const t = now(); byId.clear(); leaf = null; offset = 0; lastSize = -1; chain = []; groups = []; order.clear(); groupOfOrder.length = 0; await load($, 'force'); return { text: `TPRELOAD ${rnd(now() - t)}` } }
    if (a[0] === 'open') return { text: JSON.stringify(await $.ui.open({ id: PANE, title: '目录', columns: 44 })) }
    return { text: 'tperf dump|jump G [u|a]|cpstress K|panestress W|reload|open' }
  })

  on('ui.scroll', { requestId: PANE }, async ($: $T, e: any) => {
    if (e.origin.kind !== 'person') return {}
    top = Math.max(0, top + e.by); paused = true; bump('wheel'); poke($)
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($: $T, e: any) => {
    const t0 = now()
    bump('pane')
    const { Box, Text, Button } = $.ui.resolve(e)
    await read($, verAtom)
    const cpv = await read($, cpAtom)
    const filter = ((await $.store.get('filter')) as string) ?? 'all'
    const t1 = now()
    const pr = e.props
    const W = pr.bodyColumns
    const rows = pr.scroll.bodyRows
    const { entries, firstOfGroup } = entriesFor(filter, W)
    const t2 = now()
    if (cpv !== followedCp) { followedCp = cpv; paused = false }
    const room = rows - 3
    let maxTop = entries.length
    { let acc = 0; for (let k = entries.length - 1; k >= 0; k--) { acc += entries[k]!.lines.length + (sepAfter(entries[k]!, entries[k + 1]) ? 1 : 0); if (acc > room) break; maxTop = k } }
    if (!paused && cpv >= 0) {
      const first = PANE_MODE === 'cached' ? (firstOfGroup.get(cpv) ?? -1) : entries.findIndex(x => x.g === cpv)
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
      if (used + en.lines.length > room) break
      vis.push(en.key)
      const hl = en.g === cpv
      const bar = hl ? '▌ ' : '  '
      /* 2.1.287's Button takes a label only: the highlight bar sits beside it */
      body.push(<Box key={`row:${en.key}`} flexDirection="row">
        <Text color={hl ? 'cyan' : undefined} dimColor={!hl}>{en.lines.map(() => bar).join('\n')}</Text>
        <Button key={en.key} plain hover={{ inverse: true }} label={en.lines.map(l => l.pre + l.text).join('\n')} onPress={() => { void jumpTo($, en.g, en.side) }} />
      </Box>)
      used += en.lines.length
      if (sepAfter(en, entries[k + 1]) && used < room) { body.push(<Text> </Text>); used++ }
    }
    lastVisible = vis
    while (used < room) { body.push(<Text> </Text>); used++ }
    const tree = (
      <Box flexDirection="column">
        <Text>{`${filter === 'all' ? '●' : '○'}全部 ○用户 ○Agent`}</Text>
        {loadError ? <Text dimColor>{loadError}</Text> : null}
        {body}
        <Text dimColor wrap="truncate-end">{`TP g${groups.length} cp${cpv}${paused ? ' 暂停' : ''} ${PANE_MODE}/${CP_MODE}`}</Text>
        <Text> </Text>
      </Box>
    )
    const t3 = now()
    put('paneAwaitMs', t1 - t0); put('paneBuildMs', t2 - t1); put('paneDrawMs', t3 - t2); put('paneMs', t3 - t0)
    if (!readyLogged && groups.length) { readyLogged = true; log({ ev: 'ready', sinceModuleMs: Date.now() - T0, sincePerf0: rnd(now() - NOW0) }) }
    return tree
  })
}
