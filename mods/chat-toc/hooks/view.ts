/* The two choices the person makes about what the pane shows: the View
   filter (which sides of the Turn groups) and the Layout (how each side is
   drawn). Both are kept in `$.store` across sessions, as is whether the
   band above the prompt is hidden (band.ts), the only things chat-toc
   keeps; a value it does not know reads as the default. */

import { text as words } from './text'

export type ViewFilter = 'all' | 'user' | 'agent'
export type Layout = 'card' | 'compact' | 'timeline'

export const FILTER_KEY = 'viewFilter'
export const LAYOUT_KEY = 'layout'

/* The filter row's Buttons, left to right, each with its hotkey. */
export const FILTERS: readonly { filter: ViewFilter; hotkey: string }[] = [
  { filter: 'all', hotkey: '1' },
  { filter: 'user', hotkey: '2' },
  { filter: 'agent', hotkey: '3' },
]

const LAYOUTS: readonly Layout[] = ['card', 'compact', 'timeline']
export const layoutName = (layout: Layout): string => words.layouts[layout]
export const LAYOUT_HOTKEY = 'l'

/* The side a jump that is not an entry's press goes to (a walk, a search's
   submit): the Agent reply's under Agent, else the User input's. */
export const jumpSide = (filter: ViewFilter): 'user' | 'agent' => (filter === 'agent' ? 'agent' : 'user')

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

/* A filter Button's label: its name in the system's language. The chosen one is drawn at full
   strength and marked by the tab rule below the row. */
export function filterLabel(filter: ViewFilter): string {
  return words.filters[filter] ?? ''
}

/* The Layout Button says the Layout in use, not the next one. */
export function layoutLabel(layout: Layout): string {
  return words.layoutButton(layoutName(layout))
}
