/* Terminal cell widths. A Button does not wrap its label, so chat-toc folds
   and cuts every line itself: wide (CJK, fullwidth, emoji) characters take
   two cells, the rest one. */

/* Characters drawn as emoji by default (Emoji_Presentation) below the
   astral emoji planes: the host draws them two cells wide, as it does CJK. */
const BMP_EMOJI: readonly (readonly [number, number])[] = [
  [0x231a, 0x231b], [0x2329, 0x232a], [0x23e9, 0x23ec], [0x23f0, 0x23f0], [0x23f3, 0x23f3], [0x25fd, 0x25fe],
  [0x2614, 0x2615], [0x2648, 0x2653], [0x267f, 0x267f], [0x2693, 0x2693], [0x26a1, 0x26a1], [0x26aa, 0x26ab],
  [0x26bd, 0x26be], [0x26c4, 0x26c5], [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x26ea, 0x26ea], [0x26f2, 0x26f3],
  [0x26f5, 0x26f5], [0x26fa, 0x26fa], [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b], [0x2728, 0x2728],
  [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797], [0x27b0, 0x27b0],
  [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55],
]

function isWide(code: number): boolean {
  if (code < 0x1100) return false
  if (code <= 0x115f) return true
  if (code < 0x2e80) return BMP_EMOJI.some(([from, to]) => code >= from && code <= to)
  return (
    code <= 0xa4cf ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    code === 0x1f004 ||
    code === 0x1f0cf ||
    code === 0x1f18e ||
    (code >= 0x1f191 && code <= 0x1f19a) ||
    (code >= 0x1f200 && code <= 0x1f2ff) ||
    (code >= 0x1f300 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  )
}

export function charCells(ch: string): number {
  return isWide(ch.codePointAt(0) ?? 0) ? 2 : 1
}

export function textCells(text: string): number {
  let n = 0
  for (const ch of text) n += charCells(ch)
  return n
}

/* Folds text into at most `maxLines` lines of `width` cells; when text is
   left over, the last line ends in `…`. */
export function wrapCells(text: string, width: number, maxLines: number): string[] {
  const w = Math.max(2, width)
  const lines: string[] = []
  let line = ''
  let used = 0
  for (const ch of text) {
    const c = charCells(ch)
    if (used + c > w) {
      if (lines.length === maxLines - 1) {
        let cut = [...line]
        while (textCells(cut.join('')) + 1 > w) cut = cut.slice(0, -1)
        lines.push(cut.join('') + '…')
        return lines
      }
      lines.push(line)
      line = ''
      used = 0
    }
    line += ch
    used += c
  }
  if (line || lines.length === 0) lines.push(line)
  return lines
}
