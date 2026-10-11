/* The pane's own window over its entries. chat-toc draws only the entries
   in view (a tree draws at most 100,000 characters) and scrolls them itself.
   Until the person scrolls, the window follows the newest entry. */

export type TocWindow = {
  /* The first entry in view. */
  start: number
  /* One past the last entry in view. */
  end: number
  /* The largest `start` that still fills the window. */
  maxStart: number
}

/* `heights[i]` is the rows entry i takes, its gap after it included.
   `top` undefined follows the end. */
export function windowOf(heights: readonly number[], bodyRows: number, top: number | undefined): TocWindow {
  const rows = Math.max(1, bodyRows)
  let maxStart = heights.length
  let used = 0
  for (let i = heights.length - 1; i >= 0; i--) {
    used += heights[i] ?? 0
    if (used > rows && maxStart < heights.length) break
    maxStart = i
  }
  const start = top === undefined ? maxStart : Math.max(0, Math.min(top, maxStart))
  let end = start
  used = 0
  while (end < heights.length) {
    const next = used + (heights[end] ?? 0)
    if (next > rows && end > start) break
    used = next
    end += 1
  }
  return { start, end, maxStart }
}

/* Where the window's top goes for entry `index` to show: unmoved when it
   shows, else as little as moves it in, at the bottom coming from above
   and at the top coming from below; undefined at the end, which follows. */
export function topRevealing(heights: readonly number[], bodyRows: number, current: TocWindow, index: number): number | undefined {
  let top = current.start
  if (index < current.start) top = index
  else if (index >= current.end) {
    const rows = Math.max(1, bodyRows)
    top = index
    let used = heights[index] ?? 0
    while (top > 0 && used + (heights[top - 1] ?? 0) <= rows) {
      top -= 1
      used += heights[top] ?? 0
    }
  }
  return top >= current.maxStart ? undefined : top
}

/* Where the window's top goes to follow the lit group, whose first entry is
   `index`: the newest when the last group is lit or none is; unmoved while
   the entry shows; else the entry one below the top, the one before it
   still in view above it. */
export function topFollowing(heights: readonly number[], bodyRows: number, top: number | undefined, index: number | undefined, isLast: boolean): number | undefined {
  if (index === undefined || isLast) return undefined
  const current = windowOf(heights, bodyRows, top)
  if (index >= current.start && index < current.end) return top
  const next = Math.max(0, index - 1)
  return next >= current.maxStart ? undefined : next
}

/* Where the window's top goes after the person scrolls `by` entries from
   `current`; undefined once it reaches the end, which follows again. */
export function scrolledTop(current: TocWindow, by: number): number | undefined {
  const top = Math.max(0, current.start + by)
  return top >= current.maxStart ? undefined : top
}
