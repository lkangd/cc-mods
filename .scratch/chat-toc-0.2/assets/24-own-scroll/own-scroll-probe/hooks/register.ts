import { atom, read, update } from 'claude-code'
import type { Register, RenderElement, UiScrollArgs } from 'claude-code'

// Throwaway probe for chat-toc 0.2 ticket 24: may a plugin scroll its own
// Pane on Desktop with `$.ui.scroll` (the transcript's is refused there)?
// From a press (the promise returned from onPress), from a timer after a
// press, and from a command. Targets: 'start', 'end', `{ key }` with
// `nearest` and `start`. And the accordion: a press on a row opens a block
// under it, then asks `{ key: 'pv', block: 'nearest' }` right away, after
// a 0 ms timer, or after 300 ms, to bring it into view.
// Everything goes to an in-memory log, shown by `/ownscroll log` and written
// whole to own-scroll-probe-<surface>.log beside the plugin.

const ID = 'own-scroll-probe'
const rev = atom({ plugin: 'own-scroll-probe', key: 'rev' } as const, 0)

type PvMode = 'pv' | 'pvt' | 'pvx' | 'none'
const PV_MODES: PvMode[] = ['pvt', 'pvx', 'pv', 'none']

const ROWS = 80
let pvMode: PvMode = 'pvt'
let opened: number | undefined
const log: string[] = []
const started = Date.now()
const counts = { render: 0, scroll: 0, call: 0 }
let lastScroll = '(none)'
let lastCall = '(none)'
let surfaceSeen = 'unknown'
// The window's first row as last heard (ui.scroll's offset after next, or a render's scroll.offset).
let offsetNow = -1
// Calls whose window is logged at the next render.
const checks: string[] = []

function stamp(): string {
  return `${((Date.now() - started) / 1000).toFixed(2)}s`
}

async function note($: any, line: string) {
  log.push(`${stamp()} ${line}`)
  await $.fs.write(`${$.plugin.root}/../own-scroll-probe-${surfaceSeen}.log`, log.join('\n') + '\n').catch(() => undefined)
}

async function bump($: any) {
  await update($, rev, n => n + 1)
}

async function scrollTo($: any, from: string, args: UiScrollArgs) {
  const n = ++counts.call
  await note($, `call #${n} from=${from} args=${JSON.stringify(args)} offset before=${offsetNow}`)
  let result: string
  try {
    result = JSON.stringify(await $.ui.scroll(args))
  } catch (err) {
    result = `threw ${String((err as Error)?.message ?? err)}`
  }
  lastCall = `#${n} ${from} ${JSON.stringify(args.to)} -> ${result}`
  await note($, `  call #${n} -> ${result} offset now=${offsetNow}`)
  checks.push(`call #${n}`)
  await bump($)
  $.clock.after(500, () => afterwards($, n))
}

async function afterwards($: any, n: number) {
  checks.push(`call #${n} +500ms`)
  await bump($)
}

async function openUnder($: any, i: number) {
  opened = opened === i ? undefined : i
  await note($, `PRESS row ${i} opened=${opened} pvMode=${pvMode}`)
  await bump($)
  if (opened === undefined || pvMode === 'none') return
  const args: UiScrollArgs = { to: { key: pvMode }, in: ID, block: 'nearest' }
  $.clock.after(300, () => scrollTo($, `timer(300ms, key ${pvMode})`, args))
}

function later($: any, ms: number, args: UiScrollArgs) {
  void note($, `PRESS timer ${ms}ms ${JSON.stringify(args.to)}`)
  $.clock.after(ms, () => scrollTo($, `timer ${ms}ms`, args))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'ownscroll',
      description: 'own-scroll-probe: open | close | log | start | end | key <n> [nearest|start] | after <ms> start|end',
      immediate: true,
    })
    await note($, `session.start version=${await $.session.version()}`)
    return next(e)
  })

  on('ui.scroll', { component: 'Pane', requestId: 'own-scroll-probe' }, async ($, e, next) => {
    counts.scroll++
    lastScroll = `#${counts.scroll} by=${e.by} offset=${e.offset} bodyRows=${e.bodyRows} contentRows=${e.contentRows} origin=${JSON.stringify(e.origin)}`
    const r = await next(e)
    if (r.deny === undefined) offsetNow = e.offset
    if (e.origin.kind !== 'person' || counts.scroll % 10 === 1) await note($, `ui.scroll ${lastScroll} next -> ${JSON.stringify(r)}`)
    await bump($)
    return r
  })

  on('ui.render', { component: 'Pane', requestId: 'own-scroll-probe' }, async ($, e, next) => {
    counts.render++
    surfaceSeen = e.surface
    await read($, rev)
    const { Box, Text, Button } = $.ui.resolve(e)
    const scroll = (e.props as any).scroll
    if (typeof scroll?.offset === 'number') offsetNow = scroll.offset
    for (const c of checks.splice(0)) await note($, `  ${c}: render offset=${scroll?.offset}`)
    if (counts.render <= 2 || counts.render % 50 === 0) await note($, `render #${counts.render} surface=${e.surface} scroll=${JSON.stringify(scroll)}`)
    const btn = (key: string, label: string, onPress: () => unknown) => h(Button, { key, plain: true, onPress }, label)
    const header = [
      h(Text, { key: 'title', bold: true, wrap: 'truncate-end' }, `own-scroll-probe r=${counts.render} offset=${scroll?.offset} pv=${pvMode} open=${opened ?? '-'}`),
      h(Text, { key: 'h2', wrap: 'truncate-end' }, `last call: ${lastCall}`),
      h(Text, { key: 'h3', wrap: 'truncate-end' }, `last ui.scroll: ${lastScroll}`),
      btn('b-end', '[A] press → end', () => scrollTo($, 'press', { to: 'end', in: ID })),
      btn('b-key', '[B] press → row 70 (nearest)', () => scrollTo($, 'press', { to: { key: 'row70' }, in: ID, block: 'nearest' })),
      btn('b-keys', '[C] press → row 70 (start)', () => scrollTo($, 'press', { to: { key: 'row70' }, in: ID, block: 'start' })),
      btn('b-te', '[D] timer 1 s → end', () => later($, 1000, { to: 'end', in: ID })),
      btn('b-ts', '[E] timer 4 s → start (scroll down meanwhile)', () => later($, 4000, { to: 'start', in: ID })),
      btn('b-pv', `[F] preview key after 300 ms: ${pvMode} (press to change)`, async () => {
        pvMode = PV_MODES[(PV_MODES.indexOf(pvMode) + 1) % PV_MODES.length]!
        await note($, `pvMode=${pvMode}`)
        await bump($)
      }),
      h(Text, { key: 'h4', dimColor: true }, 'Rows: a press opens a block under it. Every 10th row has ↑ top Buttons.'),
    ]
    const rows: RenderElement[] = []
    for (let i = 0; i < ROWS; i++) {
      rows.push(btn(`row${i}`, `row ${String(i).padStart(2, '0')} ${'·'.repeat(16)} press to open below`, () => openUnder($, i)) as RenderElement)
      if (opened === i) {
        rows.push(h(Box, { key: 'pv', flexDirection: 'column', borderStyle: 'round', paddingX: 1 },
          h(Text, { key: 'pvt', bold: true }, `preview of row ${i} (pv Box, pvt Text, pvx Button)`),
          ...Array.from({ length: 10 }, (_, k) => h(Text, { key: `pv${k}` }, `line ${k + 1} of the opened block`)),
          btn('pvx', '✕ close', () => openUnder($, i))) as RenderElement)
      }
      if (i % 10 === 9) {
        rows.push(h(Box, { key: `tops${i}`, flexDirection: 'row', columnGap: 2 },
          btn(`top${i}`, `↑ top ('start')`, () => scrollTo($, `press(top at ${i})`, { to: 'start', in: ID })),
          btn(`topk${i}`, `↑ top ({ key: 'title' })`, () => scrollTo($, `press(topk at ${i})`, { to: { key: 'title' }, in: ID, block: 'start' })),
          btn(`topt${i}`, `↑ top in 500 ms`, () => later($, 500, { to: 'start', in: ID }))) as RenderElement)
      }
    }
    return h(Box, { flexDirection: 'column' }, ...header, h(Box, { key: 'body', flexDirection: 'column' }, ...rows), h(Text, { key: 'end', bold: true }, '=== END OF TREE ===')) as RenderElement
  })

  on('command.run', { command: 'ownscroll' }, async ($, e) => {
    const [verb, ...rest] = e.args.trim().split(/\s+/)
    if (verb === 'log') return { text: `${log.join('\n') || '(empty)'}\ncounts=${JSON.stringify(counts)}` }
    if (verb === 'close') { await $.ui.close({ id: ID }); await note($, 'closed'); return {} }
    if (verb === 'start' || verb === 'end') await scrollTo($, 'command', { to: verb, in: ID })
    else if (verb === 'key' && rest[0]) await scrollTo($, 'command', { to: { key: `row${rest[0]}` }, in: ID, block: rest[1] === 'start' ? 'start' : 'nearest' })
    else if (verb === 'after' && rest[0] && (rest[1] === 'start' || rest[1] === 'end')) later($, Number(rest[0]), { to: rest[1], in: ID })
    else if (verb === 'open' || verb === '') {
      const r = await $.ui.open({ id: ID, title: 'own-scroll-probe' })
      await note($, `open ${JSON.stringify(r)}`)
      await bump($)
    } else return { text: `unknown: ${e.args}` }
    return {}
  })
}
