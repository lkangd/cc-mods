/* Walking the band's focus ring with the arrow keys, decided as a pure
   function over the rows it can stop on.

   On the terminal the arrow keys scroll a band taller than its rows and leave
   the ring where it is; over the band's entries they walk the ring instead,
   one stop at a time, and the window follows it. */

export const TITLE_KEY = 'prompt-history:toggle'

/* Where one arrow press moves the ring: the neighbouring stop; the title,
   from the first stop when nothing lies before it in the project, and back
   down from the title to the first stop; or nowhere (undefined), at the last
   stop, or at the first while an earlier batch is still on its way. A ring
   anywhere else is not the band's to walk. */
export function arrowStep(
  stops: readonly string[],
  ring: string | undefined,
  by: 1 | -1,
  earlier: boolean,
): string | undefined {
  if (ring === TITLE_KEY) return by > 0 ? stops[0] : undefined
  const at = ring === undefined ? -1 : stops.indexOf(ring)
  if (at < 0) return undefined
  const next = stops[at + by]
  if (next !== undefined) return next
  return by < 0 && !earlier ? TITLE_KEY : undefined
}
