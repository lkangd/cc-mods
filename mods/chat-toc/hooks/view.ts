/* The two choices the person makes about what the pane shows: the View
   filter (which sides of the Turn groups) and the Layout (how each side is
   drawn). Both are kept in `$.store` across sessions, the only things
   chat-toc keeps; a value it does not know reads as the default. */

export type ViewFilter = 'all' | 'user' | 'agent'
export type Layout = 'card' | 'compact' | 'timeline'

export const FILTER_KEY = 'viewFilter'
export const LAYOUT_KEY = 'layout'

/* The filter row's Buttons, left to right, each with its hotkey. */
export const FILTERS: readonly { filter: ViewFilter; name: string; hotkey: string }[] = [
  { filter: 'all', name: '全部', hotkey: '1' },
  { filter: 'user', name: '用户', hotkey: '2' },
  { filter: 'agent', name: 'Agent', hotkey: '3' },
]

const LAYOUTS: readonly Layout[] = ['card', 'compact', 'timeline']
export const LAYOUT_NAMES: Record<Layout, string> = { card: '卡片', compact: '紧凑', timeline: '时间轴' }
export const LAYOUT_HOTKEY = 'l'

export function filterOf(value: unknown): ViewFilter {
  return FILTERS.some(f => f.filter === value) ? (value as ViewFilter) : 'all'
}

export function layoutOf(value: unknown): Layout {
  return LAYOUTS.includes(value as Layout) ? (value as Layout) : 'card'
}

/* Card, then compact, then timeline, then card again. */
export function nextLayout(layout: Layout): Layout {
  return LAYOUTS[(LAYOUTS.indexOf(layout) + 1) % LAYOUTS.length] ?? 'card'
}

/* A filter Button's label: its name. The chosen one is drawn at full
   strength and marked by the tab rule below the row. */
export function filterLabel(filter: ViewFilter): string {
  return FILTERS.find(f => f.filter === filter)?.name ?? ''
}

/* The Layout Button says the Layout in use, not the next one. */
export function layoutLabel(layout: Layout): string {
  return `布局 ${LAYOUT_NAMES[layout]}`
}
