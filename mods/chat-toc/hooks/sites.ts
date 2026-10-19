/* What the transcript drew: the requestIds the host's render sites
   (`UserMessage`, `AssistantMessage`, `CommandOutput`, `ToolGroup`, and a
   tool row not folded into a group: `ToolUse`, `ToolResult`) were
   drawn under, the chain row each one is, and where each is on screen.

   A requestId is a row's uuid, the uuid behind `collapsed-`, a tool call's
   id, or a uuid whose last 12 digits number one block of a split message;
   it is matched against the chain in that order. The host draws before the
   file is read (a hot reload redraws the rows on screen first), so an id
   that matches nothing yet is kept and tried again after the next read.

   The on-screen records are for the Current position: one per site
   instance, the latest report numbered, a site reported off screen
   dropped. Render hooks may only touch this module state, never `$.state`. */

import type { TranscriptRow } from './transcript'

export const SITE_COMPONENTS = ['UserMessage', 'AssistantMessage', 'CommandOutput', 'ToolGroup', 'ToolUse', 'ToolResult'] as const
export type SiteComponent = (typeof SITE_COMPONENTS)[number]

/* A site's rows inside the viewport, `null` while drawn outside it,
   undefined before the host laid it out. */
export type OnScreen = { first: number; last: number; of: number } | null | undefined

export type SiteRecord = {
  component: SiteComponent
  requestId: string
  onScreen: { first: number; last: number; of: number }
  /* Report order: the record with the highest is the latest. */
  seq: number
}

const PREFIX = 24
const UUID_LENGTH = 36
const COLLAPSED = 'collapsed-'
const PLACEHOLDER = 'placeholder'

/* The chain rows a requestId can name, by each matching rule. */
export type RowIndex = {
  /* The chain the index was built from; a different array is a new chain. */
  chain: readonly TranscriptRow[]
  /* How many of its rows are indexed. */
  count: number
  /* Each row's place on the chain. */
  order: Map<string, number>
  /* A uuid's first 24 characters; null when two rows share them. */
  prefix: Map<string, string | null>
  /* A tool call's id: the row that made it. */
  toolUse: Map<string, string>
  /* A row's first tool call id, for a row that made calls. */
  toolOf: Map<string, string>
}

function addRows(index: RowIndex): void {
  const { chain } = index
  for (let i = index.count; i < chain.length; i++) {
    const row = chain[i]
    if (!row) continue
    index.order.set(row.uuid, i)
    const key = row.uuid.slice(0, PREFIX)
    index.prefix.set(key, index.prefix.has(key) ? null : row.uuid)
    if (row.type !== 'assistant') continue
    const content = row.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content as { type?: unknown; id?: unknown }[]) {
      if (block?.type !== 'tool_use' || typeof block.id !== 'string') continue
      index.toolUse.set(block.id, row.uuid)
      if (!index.toolOf.has(row.uuid)) index.toolOf.set(row.uuid, block.id)
    }
  }
  index.count = chain.length
}

export function rowIndex(chain: readonly TranscriptRow[]): RowIndex {
  const index: RowIndex = { chain, count: 0, order: new Map(), prefix: new Map(), toolUse: new Map(), toolOf: new Map() }
  addRows(index)
  return index
}

/* Brings the index up to the chain after a read: the rows it grew by, or the
   whole of a chain that is not the one indexed. True when it started over. */
export function syncRows(index: RowIndex, chain: readonly TranscriptRow[]): boolean {
  const isNew = chain !== index.chain || chain.length < index.count
  if (isNew) Object.assign(index, rowIndex(chain))
  else addRows(index)
  return isNew
}

/* The chain row a requestId names, by the four rules in order. */
export function matchRequestId(index: RowIndex, requestId: string): string | undefined {
  if (requestId === PLACEHOLDER) return undefined
  if (index.order.has(requestId)) return requestId
  const body = requestId.startsWith(COLLAPSED) ? requestId.slice(COLLAPSED.length) : requestId
  if (index.order.has(body)) return body
  const caller = index.toolUse.get(body)
  if (caller !== undefined) return caller
  if (body.length !== UUID_LENGTH) return undefined
  return index.prefix.get(body.slice(0, PREFIX)) ?? undefined
}

export type Sites = {
  /* Every requestId drawn since the module loaded, by the site that drew it. */
  drawn: Map<string, SiteComponent>
  /* The chain row each drawn requestId names, as far as the reads tell. */
  rowOf: Map<string, string>
  /* The requestId to scroll to for a row: the one a message site drew it
     under, else a tool group's. */
  idOf: Map<string, { requestId: string; component: SiteComponent }>
  /* Drawn ids no chain row matched yet. */
  unmatched: Set<string>
  /* What is on screen now, by `<component>|<requestId>`. */
  onScreen: Map<string, SiteRecord>
  seq: number
}

export function newSites(): Sites {
  return { drawn: new Map(), rowOf: new Map(), idOf: new Map(), unmatched: new Set(), onScreen: new Map(), seq: 0 }
}

function bind(sites: Sites, requestId: string, component: SiteComponent, uuid: string): void {
  sites.rowOf.set(requestId, uuid)
  sites.unmatched.delete(requestId)
  const held = sites.idOf.get(uuid)
  if (held === undefined || (held.component === 'ToolGroup' && component !== 'ToolGroup')) sites.idOf.set(uuid, { requestId, component })
}

/* A render site drawn under `requestId`: records it and where it is on
   screen, and answers the chain row it is, when the reads know it. */
export function noteSite(sites: Sites, index: RowIndex, component: SiteComponent, requestId: string, onScreen: OnScreen): string | undefined {
  if (requestId === PLACEHOLDER) return undefined
  const key = `${component}|${requestId}`
  if (onScreen === null) sites.onScreen.delete(key)
  else if (onScreen !== undefined) sites.onScreen.set(key, { component, requestId, onScreen, seq: ++sites.seq })
  const known = sites.rowOf.get(requestId)
  if (known !== undefined) return known
  if (!sites.drawn.has(requestId)) sites.drawn.set(requestId, component)
  const uuid = matchRequestId(index, requestId)
  if (uuid === undefined) sites.unmatched.add(requestId)
  else bind(sites, requestId, component, uuid)
  return uuid
}

/* After a read: matches again every drawn id when the chain is a new one
   (`isNew`), else only the ids nothing matched yet. Answers the rows
   matched this time. */
export function resolveSites(sites: Sites, index: RowIndex, isNew = false): string[] {
  const ids = isNew ? [...sites.drawn.keys()] : [...sites.unmatched]
  if (isNew) {
    sites.rowOf.clear()
    sites.idOf.clear()
  }
  const found: string[] = []
  for (const requestId of ids) {
    const component = sites.drawn.get(requestId)
    const uuid = component === undefined ? undefined : matchRequestId(index, requestId)
    if (uuid === undefined || component === undefined) {
      sites.unmatched.add(requestId)
      continue
    }
    bind(sites, requestId, component, uuid)
    found.push(uuid)
  }
  return found
}

/* Whether the host drew the row since the module loaded. */
export function isDrawn(sites: Sites, uuid: string): boolean {
  return sites.idOf.has(uuid)
}

/* The requestId a jump to a row scrolls to: the one the host drew it
   under; for a row never drawn, its first tool call's id when it made
   calls (the host finds a tool row, collapsed or not, by that id), else its
   uuid. */
export function hostIdOf(sites: Sites, index: RowIndex, uuid: string): string {
  return sites.idOf.get(uuid)?.requestId ?? index.toolOf.get(uuid) ?? uuid
}
