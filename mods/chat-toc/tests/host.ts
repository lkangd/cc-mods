/* A stand-in for Claude Code beneath chat-toc: the transcript file, the
   clock, the panes, and a record of what chat-toc asked of them. */

import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On, PaneOpenArgs, UiPane } from 'claude-code'

export const PANE = 'chat-toc'
export const TRANSCRIPT = '/home/synthetic/.claude/projects/p/synthetic-session.jsonl'
export const NOW = new Date(2026, 9, 10, 18, 0).getTime()

export type DrawnButton = { key: unknown; label: unknown; plain: unknown; dimColor: unknown; hover: unknown }

/* The Buttons of a drawn tree in order, with what the surface draws them
   by; hover styles sit beside an element's props, not in them. */
export function drawnButtons(tree: unknown): DrawnButton[] {
  const out: DrawnButton[] = []
  const walk = (node: unknown) => {
    if (typeof node !== 'object' || node === null) return
    const el = node as { type?: string; props?: Record<string, unknown>; hover?: unknown; children?: unknown[] }
    if (el.type === 'Button') {
      const p = el.props ?? {}
      out.push({ key: p.key, label: p.label, plain: p.plain, dimColor: p.dimColor, hover: el.hover })
    }
    for (const child of el.children ?? []) walk(child)
  }
  walk(tree)
  return out
}

/* Entry Buttons are keyed `g<group>.<side>[.<line>]`; the filter row's are not. */
export const isEntryKey = (key: unknown) => typeof key === 'string' && /^g\d+\./.test(key)

/* The text of every entry Button drawn, in order. */
export async function entryTexts(pane: { findAll: (q: { type: string }) => Promise<{ key: string | undefined; text: string }[]> }) {
  return (await pane.findAll({ type: 'Button' })).filter(b => isEntryKey(b.key)).map(b => b.text)
}

export type Host = {
  clock: MockClock
  /* The transcript file's text; undefined while the file does not exist. */
  file: string | undefined
  panes: UiPane[]
  opens: PaneOpenArgs[]
  /* The panes closed, by id and whose close it was. */
  closes: { id: string; origin: string }[]
  reads: string[]
  scrolls: unknown[]
  /* While set, a read of the file waits for it before answering. */
  hold?: Promise<void>
  /* Where the session's transcript is; TRANSCRIPT unless set. */
  path: string
  /* The commands run, as chat-toc ran them. */
  runs: { argv: readonly string[]; env?: Record<string, string> }[]
  /* While set, the file exists but reading it is refused this way. */
  refuse?: 'denied' | 'error'
  /* The status line chat-toc set, each call in order; undefined clears. */
  statuses: (string | undefined)[]
  /* While set, an open leaves the pane waiting undrawn, as the host does
     for an unasked open on a narrow terminal. */
  unplaced?: boolean
  /* chat-toc's `$.store`, as the host keeps it across sessions. */
  store: Record<string, unknown>
  /* While set, `$.store.set` is refused. */
  refuseStore?: boolean
  /* Where the pane's focus ring went, and who moved it. */
  focuses: { element: string | undefined; origin: string }[]
}

/* What the shell and Windows PowerShell commands of a chunked read write:
   `bytes` bytes of the file at `offset`, as is or in base64. */
function runChunk(world: Host, argv: readonly string[], env: Record<string, string> | undefined) {
  const isPowerShell = argv[0] === 'powershell.exe'
  const path = isPowerShell ? env?.CHAT_TOC_PATH : argv[5]
  const offset = Number(isPowerShell ? env?.CHAT_TOC_OFFSET : argv[4])
  const bytes = Number(isPowerShell ? env?.CHAT_TOC_BYTES : argv[6])
  const fail = (stderr: string) => ({ exitCode: 1, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false })
  if (path !== world.path || world.file === undefined) return fail('No such file or directory')
  if (world.refuse === 'denied') return fail(isPowerShell ? 'UnauthorizedAccessException' : 'Permission denied')
  if (world.refuse === 'error') return fail('I/O error')
  const chunk = new TextEncoder().encode(world.file).slice(offset, offset + bytes)
  let stdout: string
  if (isPowerShell) {
    let binary = ''
    for (const b of chunk) binary += String.fromCharCode(b)
    stdout = btoa(binary)
  } else stdout = new TextDecoder().decode(chunk)
  return { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
}

/* The engine resolves a path that is not absolute here, as a Windows path is
   on macOS and Linux, against the working directory. */
function isTranscript(world: Host, path: string): boolean {
  return path === world.path || path.endsWith('/' + world.path)
}

export function host(on: On, file?: string, path = TRANSCRIPT, stored: Record<string, unknown> = {}): Host {
  const world: Host = {
    clock: mock.clock(on, { now: NOW }),
    file,
    panes: [],
    opens: [],
    closes: [],
    reads: [],
    scrolls: [],
    path,
    runs: [],
    store: { ...stored },
    focuses: [],
    statuses: [],
  }
  on('store.get', (_$, e) => ({ value: world.store[e.key] }))
  on('store.set', (_$, e) => {
    if (world.refuseStore) throw new Error('CT-SYN store refused')
    world.store[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  /* The ring moves where it is asked to; the test sees each move. */
  on('ui.focus', (_$, e) => {
    world.focuses.push({ element: e.element, origin: e.origin.kind })
    return {}
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => ({}))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', (_$, e) => {
    world.opens.push({ ...e })
    const isPlaced = world.unplaced !== true
    const pane = { id: e.id, title: e.title ?? e.id, isShown: true, isFocused: e.focus === true, isPlaced }
    const at = world.panes.findIndex(p => p.id === e.id)
    if (at === -1) world.panes.push(pane)
    else if (e.focus === true) world.panes[at] = pane
    else if (isPlaced) world.panes[at] = { ...world.panes[at]!, isPlaced }
    return { value: isPlaced ? { isPlaced: true as const } : { isPlaced: false as const, reason: 'unasked below 144 columns (100 now)' } }
  })
  on('ui.close', (_$, e) => {
    world.closes.push({ id: e.id, origin: e.origin.kind })
    world.panes = world.panes.filter(p => p.id !== e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: world.panes }))
  /* The engine's own hint line, beneath a plugin that passes it on. */
  on('ui.render', { component: 'PromptHint' }, () => ({ type: 'Text' as const, props: {}, children: ['? for shortcuts'] }))
  on('ui.status', (_$, e) => {
    world.statuses.push(e.text)
    return { value: undefined }
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('fs.exists', (_$, e) => ({ value: isTranscript(world, e.path) && world.file !== undefined }))
  on('fs.stat', (_$, e) => {
    if (!isTranscript(world, e.path) || world.file === undefined) throw new Error('ENOENT')
    return { value: { kind: 'file' as const, size: new TextEncoder().encode(world.file).length, mtimeMs: 0, isLink: false } }
  })
  on('process.run', (_$, e) => {
    world.runs.push({ argv: e.argv, ...(e.init?.env === undefined ? {} : { env: e.init.env }) })
    return { value: runChunk(world, e.argv, e.init?.env) }
  })
  on('fs.read', async (_$, e) => {
    if (!isTranscript(world, e.path) || world.file === undefined) throw new Error('ENOENT')
    if (world.refuse === 'denied') throw new Error("EACCES: permission denied, open '" + e.path + "'")
    if (world.refuse === 'error') throw new Error('EIO: i/o error')
    world.reads.push(e.path)
    const text = world.file
    if (world.hold) await world.hold
    return { value: text }
  })
  on('ui.scroll', (_$, e) => {
    world.scrolls.push({ ...e })
    return {}
  })
  return world
}

/* How many times the file was read, whole or a chunk at a time. */
export function readsOf(world: Host): number {
  return world.reads.length + world.runs.length
}

/* The terminal drawing the hint line under the prompt, as it does at
   start and after every change of width: how chat-toc learns the layout. */
export async function drawHint($: Engine, isFullscreen = true, columns = 160): Promise<void> {
  await $.ui.render({
    surface: 'terminal',
    component: 'PromptHint',
    requestId: 'prompt-hint',
    viewport: { columns, rows: 40, isFullscreen },
    props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
  })
}

/* The session starting in a terminal, fullscreen unless said, its
   transcript at TRANSCRIPT, and chat-toc's first read settled. */
export async function start($: Engine, world: Host, isFullscreen = true): Promise<void> {
  await drawHint($, isFullscreen)
  await $.classic.SessionStart({ source: 'startup', transcript_path: world.path })
  await $.session.start({ cwd: '/home/synthetic/project', surface: 'terminal', isInteractive: true })
  await world.clock.settle()
}

export function mountPane($: Engine, bodyRows = 30, placement: 'dock' | 'inline' = 'dock', isFullscreen = true) {
  return $.ui.mount({
    plugin: 'chat-toc',
    surface: 'terminal',
    component: 'Pane',
    requestId: PANE,
    viewport: { columns: 160, rows: 40, isFullscreen },
    props: {
      title: '目录',
      isFocused: false,
      bodyColumns: 44,
      placement,
      scroll: { offset: 0, bodyRows },
      view: {},
    },
  })
}

/* The main loop keeping a row, as the engine raises it. */
export function appendRow($: Engine, uuid: string, agentId?: string) {
  return $.session.append({
    message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: 'row' }] },
    door: 'response',
    origin: { kind: 'model', model: 'synthetic' },
    uuid,
    ...(agentId === undefined ? {} : { agentId }),
  })
}
