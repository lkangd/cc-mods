import { atom, read, update } from 'claude-code'
import type { Register, RenderElement } from 'claude-code'

// Throwaway probe for chat-toc 0.2 ticket 23: a Pane tree taller than the
// pane on Desktop. Whether the person's wheel raises `ui.scroll` there and with
// what numbers, whether the host scrolls the tree when the hook passes it
// through or keeps still when the hook swallows it, whether a fixed-height Box
// clips, and (for ticket 24) how tall the native controls draw beside Svg
// rulers of known heights. Switched by `/scrollprobe ...` (env cannot reach
// Desktop); everything goes to an in-memory log, shown by `/scrollprobe log`
// and written whole to scroll-probe-<surface>.log beside the plugin.

const rev = atom({ plugin: 'scroll-probe', key: 'rev' } as const, 0)

type Hook = 'pass' | 'swallow' | 'own'
type Layout = 'plain' | 'gap' | 'clip'

const settings = { hook: 'pass' as Hook, layout: 'plain' as Layout, rows: 60, clip: 10, head: false }
// The first row drawn under `own`, moved by the hook as chat-toc moves its window.
let ownTop = 0
const log: string[] = []
const started = Date.now()
const counts = { render: 0, scroll: 0 }
let lastScroll = '(none)'
let lastProps = '(no render yet)'
let select = 'card'
let surfaceSeen = 'unknown'

function stamp(): string {
  return `${((Date.now() - started) / 1000).toFixed(2)}s`
}

async function note($: any, line: string) {
  log.push(`${stamp()} ${line}`)
  await $.fs.write(`${$.plugin.root}/../scroll-probe-${surfaceSeen}.log`, log.join('\n') + '\n').catch(() => undefined)
}

async function bump($: any) {
  await update($, rev, n => n + 1)
}

const svgRect = (w: number, h: number, label: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><style>.r{fill:#d77757}.t{fill:#fff;font:10px sans-serif}</style><rect class="r" x="0" y="0" width="${w}" height="${h}" rx="3"/><text class="t" x="3" y="${Math.min(h - 3, 12)}">${label}</text></svg>`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'scrollprobe',
      description: 'scroll-probe: open | close | hook pass|swallow|own | layout plain|gap|clip [rows] | rows <n> | head on|off | top | log',
      immediate: true,
    })
    await note($, `session.start version=${await $.session.version()}`)
    return next(e)
  })

  on('ui.scroll', { component: 'Pane', requestId: 'scroll-probe' }, async ($, e, next) => {
    counts.scroll++
    lastScroll = `#${counts.scroll} by=${e.by} offset=${e.offset} bodyRows=${e.bodyRows} contentRows=${e.contentRows} origin=${JSON.stringify(e.origin)} pointer=${JSON.stringify((e as any).pointer)}`
    await note($, `ui.scroll ${lastScroll} hook=${settings.hook}`)
    if (settings.hook === 'pass') {
      const r = await next(e)
      await note($, `  next -> ${JSON.stringify(r)}`)
      await bump($)
      return r
    }
    if (settings.hook === 'own') ownTop = Math.max(0, Math.min(settings.rows - 1, ownTop + e.by))
    await bump($)
    return {}
  })

  on('ui.press', async ($, e, next) => {
    if (e.plugin === 'scroll-probe') await note($, `ui.press element=${e.element}`)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: 'scroll-probe' }, async ($, e, next) => {
    counts.render++
    surfaceSeen = e.surface
    await read($, rev)
    const { Box, Text, Button } = $.ui.resolve(e)
    const el = $.ui.resolve(e) as any
    const scroll = (e.props as any).scroll
    lastProps = `surface=${e.surface} placement=${(e.props as any).placement} bodyColumns=${(e.props as any).bodyColumns} scroll=${JSON.stringify(scroll)} viewport=${JSON.stringify(e.viewport)}`
    if (counts.render <= 3 || counts.render % 20 === 0) await note($, `render #${counts.render} ${lastProps}`)
    const header = [
      h(Text, { key: 'h1', bold: true, wrap: 'truncate-end' }, `scroll-probe r=${counts.render} hook=${settings.hook} layout=${settings.layout} rows=${settings.rows}${settings.layout === 'clip' ? ` clip=${settings.clip}` : ''} ownTop=${ownTop}`),
      h(Text, { key: 'h2', wrap: 'truncate-end' }, lastProps),
      h(Text, { key: 'h3', wrap: 'truncate-end' }, `last ui.scroll: ${lastScroll}`),
    ]
    const head = settings.head
      ? [
          h(Text, { key: 'hd', dimColor: true }, '--- head: rulers 19 / 24 / 28 / 32 / 38 px, then a Select, a native Button, an Input ---'),
          h(Box, { key: 'rulers', flexDirection: 'row', alignItems: 'center', columnGap: 1 },
            ...[19, 24, 28, 32, 38].map(px => ('Svg' in el ? h(el.Svg, { key: `r${px}`, source: svgRect(30, px, String(px)), alt: `${px}px`, width: 30, height: px }) : h(Text, { key: `r${px}` }, `${px}`))),
            'Select' in el
              ? h(el.Select, { key: 'sel', options: [{ value: 'card', label: 'Card' }, { value: 'compact', label: 'Compact' }], value: select, onSelect: (v: string) => { select = v; void bump($) } })
              : h(Text, { key: 'sel' }, '(no Select)'),
            h(Button, { key: 'nb', onPress: () => note($, 'PRESS native') }, 'native')),
          h(Box, { key: 'inrow', flexDirection: 'row', alignItems: 'center', columnGap: 1 },
            ...[19, 24, 28, 32, 38].map(px => ('Svg' in el ? h(el.Svg, { key: `i${px}`, source: svgRect(30, px, String(px)), alt: `${px}px`, width: 30, height: px }) : null)),
            h(Box, { key: 'ib', flexGrow: 1, flexShrink: 1 }, h(el.Input, { key: 'q', placeholder: 'words or a file path', submitLabel: 'show', onInput: () => undefined, onSubmit: () => undefined })),
            h(Button, { key: 'x', plain: true, onPress: () => note($, 'PRESS x') }, '✕')),
        ]
      : []
    const rowButton = (i: number) =>
      h(Button, { key: `row${i}`, plain: true, onPress: () => note($, `PRESS row ${i}`) }, `row ${String(i).padStart(3, '0')} ${'·'.repeat(20)} ${i % 2 === 0 ? 'even' : 'odd'}`)
    const indices = Array.from({ length: settings.rows }, (_, i) => i)
    let body: RenderElement
    if (settings.hook === 'own') {
      const visible = Math.max(1, (scroll?.bodyRows ?? 20) - header.length - head.length - 1)
      body = h(Box, { key: 'body', flexDirection: 'column' }, ...indices.slice(ownTop, ownTop + visible).map(rowButton)) as RenderElement
    } else if (settings.layout === 'gap') {
      const groups: number[][] = []
      for (let i = 0; i < indices.length; i += 3) groups.push(indices.slice(i, i + 3))
      body = h(Box, { key: 'body', flexDirection: 'column', gap: 1 }, ...groups.map((g, n) => h(Box, { key: `g${n}`, flexDirection: 'column' }, ...g.map(rowButton)))) as RenderElement
    } else if (settings.layout === 'clip') {
      body = h(Box, { key: 'body', flexDirection: 'column', height: settings.clip, overflow: 'hidden', borderStyle: 'single' }, ...indices.map(rowButton)) as RenderElement
    } else {
      body = h(Box, { key: 'body', flexDirection: 'column' }, ...indices.map(rowButton)) as RenderElement
    }
    return h(Box, { flexDirection: 'column' }, ...header, ...head, body, h(Text, { key: 'end', bold: true }, '=== END OF TREE ===')) as RenderElement
  })

  on('command.run', { command: 'scrollprobe' }, async ($, e) => {
    const [verb, ...rest] = e.args.trim().split(/\s+/)
    if (verb === 'log') return { text: `${log.join('\n') || '(empty)'}\ncounts=${JSON.stringify(counts)}\nlast props: ${lastProps}` }
    if (verb === 'close') { await $.ui.close({ id: 'scroll-probe' }); await note($, 'closed'); return {} }
    if (verb === 'hook' && (rest[0] === 'pass' || rest[0] === 'swallow' || rest[0] === 'own')) settings.hook = rest[0]
    else if (verb === 'layout' && (rest[0] === 'plain' || rest[0] === 'gap' || rest[0] === 'clip')) {
      settings.layout = rest[0]
      if (rest[1]) settings.clip = Number(rest[1])
    } else if (verb === 'rows' && rest[0]) settings.rows = Number(rest[0])
    else if (verb === 'head') settings.head = rest[0] !== 'off'
    else if (verb === 'top') ownTop = 0
    else if (verb !== 'open' && verb !== '') return { text: `unknown: ${e.args}` }
    if (verb === 'open' || verb === '') {
      const r = await $.ui.open({ id: 'scroll-probe', title: 'scroll-probe' })
      await note($, `open ${JSON.stringify(r)}`)
    } else await note($, `set ${JSON.stringify(settings)}`)
    await bump($)
    return {}
  })
}
