/* Terminal cell widths. A Button does not wrap its label, so chat-toc folds
   and cuts every line itself: wide (CJK, fullwidth, emoji) characters take
   two cells, the rest one. */

function isWide(code: number): boolean {
  return (
    code >= 0x1100 &&
    (code <= 0x115f ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faff) ||
      (code >= 0x20000 && code <= 0x3fffd))
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
