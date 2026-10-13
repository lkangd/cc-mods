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

/* Punctuation that closes what comes before it, which no line opens with. */
const CLOSING = new Set('，。、；：！？）」』》〉】,.;:!?)…')

/* A character of a Latin word or path: letters, digits and `_./-`. */
function isWordChar(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95 || code === 46 || code === 47 || code === 45
}
/* The longest Latin word or path that moves down whole. */
const WORD_MOVES = 14

/* What of a full `line` moves down to the next when the character at
   `text[at]` does not fit: the line's last character when that one closes
   it; the start of a word it continues, when the whole word is short and
   the line has more than it. */
function carriedDown(line: string, text: string, at: number, width: number): string {
  const next = text.codePointAt(at) ?? 0
  if (CLOSING.has(String.fromCodePoint(next))) {
    const last = line.codePointAt(line.length - 1) ?? 0
    const lastLength = last >= 0xdc00 && last <= 0xdfff ? 2 : 1
    return line.length > lastLength ? line.slice(line.length - lastLength) : ''
  }
  if (!isWordChar(next)) return ''
  let start = line.length
  while (start > 0 && isWordChar(line.charCodeAt(start - 1))) start--
  if (start === line.length || start === 0) return ''
  let word = line.length - start
  for (let i = at; i < text.length && word <= WORD_MOVES && isWordChar(text.charCodeAt(i)); i++) word++
  return word <= WORD_MOVES && word <= width ? line.slice(start) : ''
}

/* Folds text into at most `maxLines` lines of `width` cells, the first of
   `firstWidth`; when text is left over, the last line ends in `…`. */
export function wrapCells(text: string, width: number, maxLines: number, firstWidth = width): string[] {
  const widthOf = (line: number) => Math.max(2, line === 0 ? firstWidth : width)
  const lines: string[] = []
  let line = ''
  let used = 0
  /* `at` is where `ch` starts in `text`, in UTF-16 units. */
  let at = 0
  let w = widthOf(0)
  for (const ch of text) {
    const here = at
    at += ch.length
    const c = charCells(ch)
    if (used + c > w) {
      if (lines.length === maxLines - 1) {
        let cut = [...line]
        while (textCells(cut.join('')) + 1 > w) cut = cut.slice(0, -1)
        lines.push(cut.join('').trimEnd() + '…')
        return lines
      }
      w = widthOf(lines.length + 1)
      const carry = carriedDown(line, text, here, w)
      lines.push(line.slice(0, line.length - carry.length).trimEnd())
      line = carry
      used = textCells(carry)
      /* A fold at a space drops it. */
      if (ch === ' ' && carry === '') continue
    }
    line += ch
    used += c
  }
  if (line || lines.length === 0) lines.push(line)
  return lines
}
