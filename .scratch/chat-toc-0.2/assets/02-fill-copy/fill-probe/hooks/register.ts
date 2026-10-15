import type { Register, RenderElement, RenderSurface } from 'claude-code'

// Throwaway probe for chat-toc 0.2 ticket 02: how $.prompt.fill and
// $.ui.copy behave at their edges. Every result goes to an in-memory log,
// drawn at the pane's foot and written whole to PROBE_LOG (or next to the
// plugin) after each entry.

const log: string[] = []
let logPath: string | undefined
const started = Date.now()

const MULTI = 'L1 first line\nL2 second line\n```js\nx()\n```'
const INVISIBLE = 'a​b\u0007c\u001b[31md'
const COPY_SMALL = 'COPY-PROBE 短文 😀\nsecond line\ttab'

function big(n: number): string {
  const unit = '0123456789abcdef'
  return unit.repeat(Math.ceil(n / unit.length)).slice(0, n)
}

function stamp(): string {
  return `${((Date.now() - started) / 1000).toFixed(1)}s`
}

async function note($: any, line: string) {
  log.push(`${stamp()} ${line}`)
  logPath ??= (await $.env.get('PROBE_LOG')) ?? `${$.plugin.root}/../fill-probe.log`
  await $.fs.write(logPath, log.join('\n') + '\n').catch(() => undefined)
}

async function fill($: any, label: string, text: string, mode?: 'replace' | 'append' | 'insert') {
  const before = await $.prompt.read()
  try {
    const r = await $.prompt.fill(mode ? { text, mode } : { text })
    const after = await $.prompt.read()
    await note($, `fill ${label}: result=${JSON.stringify(r)} before=${JSON.stringify(before)} after=${JSON.stringify(after)}`)
  } catch (err) {
    await note($, `fill ${label}: threw ${String(err).slice(0, 300)}`)
  }
}

async function copy($: any, label: string, text: string, surface?: RenderSurface) {
  const t0 = Date.now()
  try {
    const r = await $.ui.copy(surface ? { text, surface } : { text })
    await note($, `copy ${label} (${text.length} chars, surface=${surface ?? 'unset'}): result=${JSON.stringify(r)} in ${Date.now() - t0}ms`)
  } catch (err) {
    await note($, `copy ${label}: threw ${String(err).slice(0, 300)}`)
  }
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'fillprobe', description: 'fill-probe: open the pane, or `fill <text>` / `copy <text>` / `log`', immediate: true })
    if ((await $.env.get('PROBE_BOOT')) === '1') {
      void fill($, 'at session.start', 'BOOT-FILL')
      $.clock.after(3000, () => { void fill($, 'boot+3s', 'BOOT-FILL-3S') })
    }
    return next(e)
  })

  // The calling plugin's own hook: does its own fill pass here?
  on('prompt.fill', async ($, e, next) => {
    const r = await next(e)
    await note($, `own prompt.fill hook saw ${JSON.stringify({ text: e.text.slice(0, 40), mode: e.mode, origin: e.origin })} -> ${JSON.stringify(r)}`)
    return r
  })

  on('ui.copy', async ($, e, next) => {
    const r = await next(e)
    await note($, `own ui.copy hook saw ${e.text.length} chars surface=${e.surface} -> ${JSON.stringify(r)}`)
    return r
  })

  on('turn.start', async ($, e, next) => { await note($, 'turn.start'); return next(e) })
  on('turn.complete', async ($, e, next) => { await note($, 'turn.complete'); return next(e) })

  on('ui.render', { component: 'Pane', requestId: 'fill-probe' }, async ($, e, next) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const b = (key: string, hotkey: string, label: string, onPress: (p: any) => unknown) =>
      h(Button, { key, hotkey, plain: true, onPress: (p: any) => onPress(p) }, label)
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true }, `fill-probe on ${e.surface}`),
      b('r', 'r', 'fill replace', () => fill($, 'replace', 'FILL-R')),
      b('a', 'a', 'fill append', () => fill($, 'append', '+FILL-A', 'append')),
      b('i', 'i', 'fill insert', () => fill($, 'insert', '<I>', 'insert')),
      b('m', 'm', 'fill multi-line', () => fill($, 'multiline', MULTI)),
      b('s', 's', 'fill /command', () => fill($, 'slash', '/compact keep notes')),
      b('x', 'x', 'fill !cmd', () => fill($, 'bang', '!echo hi')),
      b('z', 'z', 'fill invisible', () => fill($, 'invisible', INVISIBLE)),
      b('e', 'e', 'fill empty', () => fill($, 'empty', '')),
      b('d', 'd', 'fill in 6s', () => { $.clock.after(6000, () => { void fill($, 'delayed', 'FILL-LATE') }) }),
      b('c', 'c', 'copy small', p => copy($, 'small', COPY_SMALL, p.surface)),
      b('k', 'k', 'copy 100 KB', p => copy($, '100k', big(100_000), p.surface)),
      b('g', 'g', 'copy 2 MB', p => copy($, '2m', big(2_000_000), p.surface)),
      b('j', 'j', 'copy 16 MB', p => copy($, '16m', big(16_000_000), p.surface)),
      b('n', 'n', 'copy no surface', () => copy($, 'nosurface', 'COPY-NOSURFACE')),
      b('l', 'l', 'copy in 6s', () => { $.clock.after(6000, () => { void copy($, 'delayed', 'COPY-LATE') }) }),
      b('p', 'p', 'read box', async () => note($, `read ${JSON.stringify(await $.prompt.read())}`)),
      h(Text, { dimColor: true }, '--- log ---'),
      ...log.slice(-6).map((line, i) => h(Text, { key: `log${i}`, wrap: 'truncate-end' }, line))) as RenderElement
  })

  on('command.run', { command: 'fillprobe' }, async ($, e) => {
    const [verb, ...rest] = e.args.trim().split(' ')
    const text = rest.join(' ')
    if (verb === 'fill') { await fill($, 'from command', text || 'CMD-FILL'); return {} }
    if (verb === 'copy') { await copy($, 'from command', text || 'CMD-COPY'); return {} }
    if (verb === 'log') return { text: log.join('\n') || '(empty)' }
    const r = await $.ui.open({ id: 'fill-probe', title: 'fill-probe', columns: 48 })
    await note($, `open ${JSON.stringify(r)}`)
    return {}
  })
}
