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

export type Host = {
  clock: MockClock
  /* The transcript file's text; undefined while the file does not exist. */
  file: string | undefined
  panes: UiPane[]
  opens: PaneOpenArgs[]
  reads: string[]
  scrolls: unknown[]
  /* While set, a read of the file waits for it before answering. */
  hold?: Promise<void>
}

export function host(on: On, file?: string): Host {
  const world: Host = { clock: mock.clock(on, { now: NOW }), file, panes: [], opens: [], reads: [], scrolls: [] }
  mock.store(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => ({}))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', (_$, e) => {
    world.opens.push({ ...e })
    return { value: { isPlaced: true as const } }
  })
  on('ui.panes', () => ({ value: world.panes }))
  on('ui.status', () => ({ value: undefined }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('fs.exists', (_$, e) => ({ value: e.path === TRANSCRIPT && world.file !== undefined }))
  on('fs.stat', (_$, e) => {
    if (e.path !== TRANSCRIPT || world.file === undefined) throw new Error('ENOENT')
    return { value: { kind: 'file' as const, size: new TextEncoder().encode(world.file).length, mtimeMs: 0, isLink: false } }
  })
  on('fs.read', async (_$, e) => {
    if (e.path !== TRANSCRIPT || world.file === undefined) throw new Error('ENOENT')
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

/* The session starting in a fullscreen terminal, its transcript at
   TRANSCRIPT, and chat-toc's first read settled. */
export async function start($: Engine, world: Host): Promise<void> {
  await $.classic.SessionStart({ source: 'startup', transcript_path: TRANSCRIPT })
  await $.session.start({ cwd: '/home/synthetic/project', surface: 'terminal', isInteractive: true })
  await world.clock.settle()
}

export function mountPane($: Engine, bodyRows = 30) {
  return $.ui.mount({
    plugin: 'chat-toc',
    surface: 'terminal',
    component: 'Pane',
    requestId: PANE,
    viewport: { columns: 160, rows: 40, isFullscreen: true },
    props: {
      title: '目录',
      isFocused: false,
      bodyColumns: 44,
      placement: 'dock',
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
