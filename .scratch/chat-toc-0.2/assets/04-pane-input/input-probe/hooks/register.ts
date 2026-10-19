import { atom, read, update } from 'claude-code'
import type { Register, RenderElement } from 'claude-code'

// Throwaway probe for chat-toc 0.2 ticket 04: an Input in the docked Pane.
// How it takes the keyboard, how often onInput fires and what each redraw
// costs, what Esc/Enter/arrows/digits do while it holds the keys, how it draws
// narrow and with CJK, and whether the mod can clear it. Everything goes to an
// in-memory log, written whole to PROBE_LOG after each entry.
//
// Env: PROBE_MODE=controlled (value={query} every draw) | fixed (value='fixed'
// every draw) | uncontrolled (no
// value, except '' drawn once after the clear Button); PROBE_AUTOFOCUS=1;
// PROBE_ROWS=<n> filler rows (~200 chars) filtered by the query, PROBE_DRAW=<n>
// of the matches drawn (the redraw's weight).

const query = atom({ plugin: 'input-probe', key: 'query' } as const, '')
const forced = atom({ plugin: 'input-probe', key: 'forced' } as const, null)
const rev = atom({ plugin: 'input-probe', key: 'rev' } as const, 0)

const log: string[] = []
let logPath: string | undefined
const started = Date.now()
const counts = { render: 0, change: 0, submit: 0 }
let lastChangeAt = 0
// Set by `/inputprobe mode <m>` and `/inputprobe autofocus on|off` where env cannot reach (Desktop).
let modeOverride: string | undefined
let autoFocusOverride: boolean | undefined

function stamp(): string {
  return `${((Date.now() - started) / 1000).toFixed(2)}s`
}

async function note($: any, line: string) {
  log.push(`${stamp()} ${line}`)
  logPath ??= (await $.env.get('PROBE_LOG')) ?? `${$.plugin.root}/../input-probe.log`
  await $.fs.write(logPath, log.join('\n') + '\n').catch(() => undefined)
}

async function setQuery($: any, value: string) {
  await update($, query, () => value)
}

async function setForced($: any, value: string | null) {
  await update($, forced, () => value)
}

async function bump($: any) {
  await update($, rev, (n) => n + 1)
}

async function focusField($: any) {
  await note($, `PRESS tofind -> focus q ${JSON.stringify(await $.ui.focus({ requestId: 'input-probe', key: 'q' }))}`)
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'inputprobe', description: 'input-probe: open | openfocus | open2 | close | close2 | focus | focusentry | mode <m> | autofocus on|off | bump | clear | set <text> | log', immediate: true })
    await note($, `session.start version=${await $.session.version()} mode=${await $.env.get('PROBE_MODE')} autofocus=${await $.env.get('PROBE_AUTOFOCUS')} rows=${await $.env.get('PROBE_ROWS')}`)
    return next(e)
  })

  on('ui.input', async ($, e, next) => {
    if (e.plugin === 'input-probe') await note($, `ui.input hook kind=${e.kind} element=${e.element} value=${JSON.stringify(e.value)} keys=${Object.keys(e).join(',')}`)
    return next(e)
  })

  on('ui.focus', async ($, e, next) => {
    if (e.plugin === 'input-probe') await note($, `ui.focus hook ${JSON.stringify(e)}`)
    return next(e)
  })

  on('ui.press', async ($, e, next) => {
    if (e.plugin === 'input-probe') await note($, `ui.press hook element=${e.element}`)
    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    await note($, `ui.close hook ${JSON.stringify(e)}`)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: 'input-probe' }, async ($, e, next) => {
    const t0 = Date.now()
    counts.render++
    const mode = modeOverride ?? (await $.env.get('PROBE_MODE')) ?? 'uncontrolled'
    const autoFocus = autoFocusOverride ?? (await $.env.get('PROBE_AUTOFOCUS')) === '1'
    const rows = Number((await $.env.get('PROBE_ROWS')) ?? '30')
    const draw = Number((await $.env.get('PROBE_DRAW')) ?? '8')
    const q = await read($, query)
    const f = await read($, forced)
    const r = await read($, rev)
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const press = (key: string) => () => note($, `PRESS ${key}`)
    const value = mode === 'controlled' ? q : mode === 'fixed' ? 'fixed' : f ?? undefined
    const filler = Array.from({ length: rows }, (_, i) => `row ${i} ${i % 3 === 0 ? '搜索 中文' : 'turn text'} ${i * 7} ${'lorem ipsum '.repeat(16)}`)
    const shown = filler.filter((r) => r.includes(q)).slice(0, draw)
    const tree = h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, wrap: 'truncate-end' }, `input-probe ${e.surface} w=${e.viewport?.columns ?? '?'} r=${counts.render} c=${counts.change} s=${counts.submit}`),
      h(Text, { wrap: 'truncate-end' }, `q=${JSON.stringify(q)} mode=${mode} rev=${r}${f !== null ? ` forced=${JSON.stringify(f)}` : ''}`),
      h(Input, {
        key: 'q',
        label: 'find',
        placeholder: 'search turns',
        submitLabel: 'go',
        ...(value !== undefined ? { value } : {}),
        ...(autoFocus ? { autoFocus: true as const } : {}),
        onInput: (v: string) => {
          counts.change++
          lastChangeAt = Date.now()
          void note($, `onInput #${counts.change} ${JSON.stringify(v)}`)
          void setQuery($, v)
          if (f !== null) void setForced($, null)
        },
        onSubmit: (v: string) => {
          counts.submit++
          void note($, `onSubmit #${counts.submit} ${JSON.stringify(v)}`)
        },
      }),
      h(Button, { key: 'tofind', plain: true, onPress: () => focusField($) }, 'to find'),
      h(Button, { key: 'e1', hotkey: '1', plain: true, onPress: press('e1') }, 'entry one'),
      h(Button, { key: 'e2', hotkey: '2', plain: true, onPress: press('e2') }, 'entry two'),
      h(Button, { key: 'e3', hotkey: '3', plain: true, onPress: press('e3') }, 'entry three'),
      h(Button, { key: 'link', hotkey: 'l', plain: true, onPress: press('link') }, 'link (l)'),
      h(Button, {
        key: 'clear', plain: true, onPress: async () => {
          await note($, 'PRESS clear')
          await setQuery($, '')
          if (mode !== 'controlled') await setForced($, '')
        },
      }, 'clear'),
      h(Text, { dimColor: true }, `--- ${shown.length} of ${rows} match ---`),
      ...shown.map((r, i) => h(Text, { key: `m${i}`, wrap: 'truncate-end' }, r)),
      h(Text, { dimColor: true }, '--- log ---'),
      ...log.slice(-4).map((line, i) => h(Text, { key: `log${i}`, wrap: 'truncate-end' }, line))) as RenderElement
    const since = lastChangeAt ? Date.now() - lastChangeAt : -1
    await note($, `render #${counts.render} q=${JSON.stringify(q)} built=${Date.now() - t0}ms sinceChange=${since}ms w=${e.viewport?.columns}`)
    return tree
  })

  on('ui.render', { component: 'Pane', requestId: 'input-probe-2' }, async ($, e, next) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true }, 'input-probe-2'),
      h(Button, { key: 'other', plain: true, onPress: () => note($, 'PRESS other') }, 'other')) as RenderElement
  })

  on('command.run', { command: 'inputprobe' }, async ($, e) => {
    const [verb, ...rest] = e.args.trim().split(' ')
    if (verb === 'log') return { text: `${log.join('\n') || '(empty)'}\ncounts=${JSON.stringify(counts)}` }
    if (verb === 'close') { await $.ui.close({ id: 'input-probe' }); await note($, 'closed'); return {} }
    if (verb === 'close2') { await $.ui.close({ id: 'input-probe-2' }); await note($, 'closed2'); return {} }
    if (verb === 'focus') { await note($, `focus q ${JSON.stringify(await $.ui.focus({ requestId: 'input-probe', key: 'q' }))}`); return {} }
    if (verb === 'focusentry') { await note($, `focus e1 ${JSON.stringify(await $.ui.focus({ requestId: 'input-probe', key: 'e1' }))}`); return {} }
    if (verb === 'mode') { modeOverride = rest[0]; await bump($); await note($, `mode ${modeOverride}`); return {} }
    if (verb === 'autofocus') { autoFocusOverride = rest[0] === 'on'; await bump($); await note($, `autofocus ${autoFocusOverride}`); return {} }
    if (verb === 'bump') { await bump($); await note($, 'bumped'); return {} }
    if (verb === 'clear') { await setQuery($, ''); await setForced($, ''); await note($, 'cleared by command'); return {} }
    if (verb === 'set') { const v = rest.join(' '); await setQuery($, v); await setForced($, v); await note($, `set ${JSON.stringify(v)}`); return {} }
    if (verb === 'open2') { await note($, `open2 ${JSON.stringify(await $.ui.open({ id: 'input-probe-2', title: 'input-probe-2' }))}`); return {} }
    const columns = rest[0] ? Number(rest[0]) : undefined
    const focus = verb === 'openfocus'
    const r = await $.ui.open({ id: 'input-probe', title: 'input-probe', ...(columns ? { columns } : {}), ...(focus ? { focus: true as const } : {}) })
    await note($, `open ${verb} columns=${columns} ${JSON.stringify(r)}`)
    return {}
  })
}
