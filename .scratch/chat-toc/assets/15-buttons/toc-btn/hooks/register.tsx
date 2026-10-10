/* PROTOTYPE — throwaway. chat-toc wayfinder ticket 15: how do the three
   Layouts draw when Button takes only a `label` (2.1.287)? Static sample data,
   no transcript. Three drawing strategies × three Layouts:
     S1 整条一个 Button：每侧一个 Button，多行 label；头行无法单独变暗
     S2 每行一个 Button：头行 dimColor，各行共用一个跳转，hover scope 连亮
     S3 头行 Text + 正文 Button：头行是暗色 Text，正文一个多行 Button
   Pane hotkeys (focus the pane first): s 画法, v Layout, h 移动高亮, o 悬停连亮.
   ↑↓ step the selection ring per entry. `/bt s1|s2|s3|a|b|c|w <n>` too. */
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

type $T = any
const PANE = 'toc-btn'
const verAtom = atom({ plugin: 'toc-btn', key: 'ver' } as const, 0)

type G = { time: string; user: string; steps: number; reply: string; status?: 'running'; dimU?: boolean }
const GROUPS: G[] = [
  { time: '12:01', user: '帮我看看 chat-toc 的 transcript 读取为什么在 macOS 上这么慢，tail -c +N 好像要好几百毫秒', steps: 6, reply: '原因是 macOS 自带的 tail 对 +N 偏移逐字节扫描；换成 dd 定位加 head 后，每 4 MB 只要 16–48 ms。' },
  { time: '12:07', user: '/model haiku', steps: 0, reply: '' },
  { time: '12:09', user: '!git status', steps: 0, reply: '', dimU: true },
  { time: '12:12', user: '把三种 Layout 都画一遍，暗色头行和正文分开着色，高亮竖条放在 Button 外面看看能不能对齐', steps: 14, reply: '三种都画好了。卡片布局里头行用 dimColor，正文用默认色；时间轴的时间列放在左边单独的 Text 里。' },
  { time: '12:20', user: '就这样，提交吧', steps: 2, reply: '' },
  { time: '12:25', user: 'Check that ASCII text mixed with 中文 still truncates at the right column width', steps: 1, reply: 'It does: wide characters count as two cells.' },
  { time: '12:31', user: '继续', steps: 3, reply: '', status: 'running' },
]

const STRATS = ['S1', 'S2', 'S3'] as const
const SNAME: Record<string, string> = { S1: '整条一个 Button', S2: '每行一个 Button', S3: '头行 Text + 正文 Button' }
const LAYOUTS = ['A', 'B', 'C'] as const
const LNAME: Record<string, string> = { A: '卡片', B: '紧凑', C: '时间轴' }

let strat: string = 'S2'
let layout: string = 'A'
let hl = 3
let hoverScope = true
let filter = 'all'
let top = 0
let focused = false
let ringKey: string | undefined
let presses = 0
let note = ''
let lastEntries: Entry[] = []
let lastVisible: string[] = []

let pokeQueued = false
function poke($: $T) {
  if (pokeQueued) return
  pokeQueued = true
  $.clock.after(0, () => { pokeQueued = false; void update($, verAtom, v => v + 1).catch(() => undefined) })
}

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

/* An entry is one side of a group: a uniform gutter (bar / marker / time
   column), an optional dim head line, then body lines. */
type Entry = { key: string; g: number; side: 'u' | 'a'; dim: boolean; gutter: string[]; gutterColor?: string; head?: string; body: string[]; bodyDim?: boolean }

function agentHead(g: G): string {
  const st = g.steps ? `${g.steps} 步` : ''
  if (g.status === 'running') return `进行中${st ? ' · ' + st : ''}`
  if (!g.reply) return `${st || '0 步'} · 无文字回复`
  return st
}
const hasAgent = (g: G) => g.steps > 0 || !!g.reply || g.status === 'running'

function buildEntries(w: number): Entry[] {
  const out: Entry[] = []
  GROUPS.forEach((g, i) => {
    const on = i === hl
    const showU = filter !== 'agent'
    const showA = filter !== 'user'
    if (layout === 'A') {
      const bar = on ? '▌' : ' '
      const gc = on ? 'cyan' : undefined
      const body = wrapN(g.user, w - 2, 2)
      if (showU) out.push({ key: `u${i}`, g: i, side: 'u', dim: !!g.dimU, gutter: Array(body.length + 1).fill(bar), gutterColor: gc, head: `你 · ${g.time}`, body })
      if (showA && hasAgent(g)) {
        const rb = g.reply ? wrapN(g.reply, w - 4, 2).map(t => '  ' + t) : []
        out.push({ key: `a${i}`, g: i, side: 'a', dim: false, gutter: Array(rb.length + 1).fill(bar), gutterColor: gc, head: '↳ ' + agentHead(g), body: rb })
      }
    } else if (layout === 'B') {
      const mk = on ? '●' : ' '
      const gc = on ? 'cyan' : undefined
      const room = w - 2 - cells(g.time) - 1
      const b = clip('› ' + g.user, room)
      if (showU) out.push({ key: `u${i}`, g: i, side: 'u', dim: !!g.dimU, gutter: [mk], gutterColor: gc, body: [b + ' '.repeat(Math.max(0, room - cells(b))) + ' ' + g.time] })
      if (showA && hasAgent(g)) {
        const head = agentHead(g)
        out.push({ key: `a${i}`, g: i, side: 'a', dim: false, gutter: [mk], gutterColor: gc, body: [clip(`  ⤷ ${head}${head && g.reply ? ' · ' : ''}${g.reply}`, w - 2)], bodyDim: true })
      }
    } else {
      const gut = on ? '┃' : '│'
      const gc = on ? 'cyan' : 'gray'
      const ub = wrapN(g.user, w - 8, 2)
      if (showU) out.push({ key: `u${i}`, g: i, side: 'u', dim: !!g.dimU, gutter: ub.map((_, k) => (k === 0 ? g.time.padEnd(5) : '     ') + ' ' + gut), gutterColor: gc, body: ub })
      if (showA && hasAgent(g)) {
        const head = agentHead(g)
        const ab = wrapN(`↳ ${head}${head && g.reply ? ' · ' : ''}${g.reply}`, w - 8, 2)
        out.push({ key: `a${i}`, g: i, side: 'a', dim: false, gutter: ab.map(() => '      ' + gut), gutterColor: gc, body: ab, bodyDim: true })
      }
    }
  })
  return out
}
const sepAfter = (e: Entry, next: Entry | undefined) => layout !== 'B' && next !== undefined && next.g !== e.g
const height = (e: Entry) => (e.head !== undefined ? 1 : 0) + e.body.length

/* which Button key the selection ring lands on for an entry */
const ringOf = (e: Entry) => e.key
const entryOfKey = (k: string) => k.replace(/\.\d+$/, '')

function press($: $T, en: Entry, how: string) {
  presses++
  const side = en.side === 'u' ? '你' : 'Agent'
  note = en.dim ? `#${presses} ${how} ${en.key}：已淡化，不跳转` : `#${presses} ${how} ${en.key} → 第 ${en.g + 1} 组 · ${side}`
  poke($)
}

async function stepRing($: $T, by: number) {
  const keys = lastEntries.map(e => e.key)
  let i = ringKey ? keys.indexOf(entryOfKey(ringKey)) : -1
  i = i < 0 ? Math.max(0, keys.indexOf(lastVisible[0] ?? '')) : Math.min(keys.length - 1, Math.max(0, i + by))
  const en = lastEntries[i]
  if (!en) return
  if (!lastVisible.includes(en.key)) { top = by > 0 ? Math.max(0, i - Math.max(0, lastVisible.length - 2)) : i; poke($) }
  await $.ui.focus({ requestId: PANE, key: ringOf(en) })
}

async function openPane($: $T, columns = 44) {
  const r = await $.ui.open({ id: PANE, title: '目录·画法原型', columns })
  return r
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'bt', description: '目录画法原型（ticket 15）', immediate: true } as any)
    void openPane($)
    return next(e)
  })

  on('command.run', { command: 'bt' }, async ($, e) => {
    const a = e.args.trim().toLowerCase()
    if (/^s[123]$/.test(a)) { strat = a.toUpperCase(); poke($); return { text: `画法 ${strat}（${SNAME[strat]}）` } }
    if (/^[abc]$/.test(a)) { layout = a.toUpperCase(); top = 0; poke($); return { text: `Layout ${LNAME[layout]}` } }
    const w = /^w\s*(\d+)$/.exec(a)
    if (w) { await $.ui.close({ id: PANE }).catch(() => undefined); const r = await openPane($, Number(w[1])); return { text: `宽 ${w[1]}：${JSON.stringify(r)}` } }
    const r = await openPane($)
    return { text: JSON.stringify(r) }
  })

  on('ui.focus', { requestId: PANE }, async ($: $T, e: any, next: any) => {
    const r = await next(e)
    if (!r.deny) ringKey = e.element
    return r
  })

  on('ui.scroll', { requestId: PANE }, async ($: $T, e: any, next: any) => {
    if (e.origin.kind !== 'person') return next(e)
    const arrow = e.pointer === undefined && Math.abs(e.by) === 1
    if (arrow && focused) { await stepRing($, e.by); return {} }
    top = Math.max(0, top + e.by)
    poke($)
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($: $T, e: any) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    await read($, verAtom)
    const pr = e.props
    focused = pr.isFocused
    const W = pr.bodyColumns
    const room = pr.scroll.bodyRows - 4
    const gw = layout === 'C' ? 8 : 2
    const entries = buildEntries(W)
    lastEntries = entries
    let maxTop = entries.length
    { let acc = 0; for (let k = entries.length - 1; k >= 0; k--) { acc += height(entries[k]!) + (sepAfter(entries[k]!, entries[k + 1]) ? 1 : 0); if (acc > room) break; maxTop = k } }
    top = Math.max(0, Math.min(top, maxTop))

    const hv = (en: Entry) => hoverScope ? { scope: `e-${en.key}`, inverse: true } : undefined
    const go = (en: Entry) => () => press($, en, '点击/Enter')

    const drawEntry = (en: Entry) => {
      const gutter = <Text color={en.gutterColor} dimColor={!en.gutterColor}>{en.gutter.map(s => s.padEnd(gw - (layout === 'C' ? 0 : 1)) + (layout === 'C' ? '' : ' ')).join('\n')}</Text>
      let right: any
      if (strat === 'S1') {
        const lines = [...(en.head !== undefined ? [en.head] : []), ...en.body]
        right = <Button key={en.key} plain dimColor={en.dim || en.bodyDim} hover={hv(en)} onPress={go(en)}>{lines.join('\n')}</Button>
      } else if (strat === 'S2') {
        const lines: { t: string; dim: boolean }[] = [
          ...(en.head !== undefined ? [{ t: en.head, dim: true }] : []),
          ...en.body.map(t => ({ t, dim: en.dim || !!en.bodyDim })),
        ]
        right = (
          <Box flexDirection="column">
            {lines.map((l, j) => <Button key={j === 0 ? en.key : `${en.key}.${j}`} plain dimColor={l.dim || en.dim} hover={hv(en)} onPress={go(en)}>{l.t || ' '}</Button>)}
          </Box>
        )
      } else {
        const headOnly = en.head !== undefined && en.body.length === 0
        right = (
          <Box flexDirection="column">
            {en.head !== undefined && !headOnly ? <Text dimColor hover={hv(en)}>{en.head}</Text> : null}
            {headOnly
              ? <Button key={en.key} plain dimColor hover={hv(en)} onPress={go(en)}>{en.head!}</Button>
              : <Button key={en.key} plain dimColor={en.dim || en.bodyDim} hover={hv(en)} onPress={go(en)}>{en.body.join('\n')}</Button>}
          </Box>
        )
      }
      return <Box key={`row-${en.key}`} flexDirection="row">{gutter}{right}</Box>
    }

    const body: any[] = []
    const vis: string[] = []
    let used = 0
    for (let k = top; k < entries.length; k++) {
      const en = entries[k]!
      const ht = height(en)
      if (used + ht > room) break
      vis.push(en.key)
      body.push(drawEntry(en))
      used += ht
      if (sepAfter(en, entries[k + 1]) && used < room) { body.push(<Text> </Text>); used++ }
    }
    lastVisible = vis
    while (used < room) { body.push(<Text> </Text>); used++ }

    const cyc = <T extends string>(xs: readonly T[], cur: string) => xs[(xs.indexOf(cur as T) + 1) % xs.length]!
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" columnGap={1}>
          {([['all', '全部', '1'], ['user', '用户', '2'], ['agent', 'Agent', '3']] as const).map(([k, l, hk]) =>
            <Button key={`f-${k}`} plain hotkey={hk} onPress={() => { filter = k; top = 0; poke($) }}>{(filter === k ? '●' : '○') + l}</Button>)}
          <Text dimColor>{`(W${W} ${focused ? '聚焦' : '未聚焦'})`}</Text>
        </Box>
        {body}
        <Text color="yellow" wrap="truncate-end">{note || ' '}</Text>
        <Box flexDirection="row" columnGap={1}>
          <Button key="k-s" plain hotkey="s" onPress={() => { strat = cyc(STRATS, strat); poke($) }}>{`${strat}`}</Button>
          <Button key="k-v" plain hotkey="v" onPress={() => { layout = cyc(LAYOUTS, layout); top = 0; poke($) }}>{LNAME[layout]!}</Button>
          <Button key="k-h" plain hotkey="h" onPress={() => { hl = (hl + 1) % GROUPS.length; poke($) }}>{`高亮${hl + 1}`}</Button>
          <Button key="k-o" plain hotkey="o" onPress={() => { hoverScope = !hoverScope; poke($) }}>{hoverScope ? '连亮' : '单亮'}</Button>
        </Box>
        <Text color="magenta" wrap="truncate-end">{`原型 ${strat} ${SNAME[strat]}`}</Text>
      </Box>
    )
  })
}
