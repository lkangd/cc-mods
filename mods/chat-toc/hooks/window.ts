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

/* Where the window's top goes after the person scrolls `by` entries from
   `current`; undefined once it reaches the end, which follows again. */
export function scrolledTop(current: TocWindow, by: number): number | undefined {
  const top = Math.max(0, current.start + by)
  return top >= current.maxStart ? undefined : top
}
