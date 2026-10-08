/* Terminal cells a Prompt Trail row takes, so every row the band draws stays
   on one line: a Button has no `wrap`, so the band cuts its labels itself. */

/* The symbols below U+1F300 that terminals draw as emoji, two cells wide
   (Unicode's Emoji_Presentation outside the ranges `cellWidth` covers). */
const WIDE_SYMBOLS: readonly (readonly [number, number])[] = [
  [0x231a, 0x231b], [0x23e9, 0x23ec], [0x23f0, 0x23f0], [0x23f3, 0x23f3],
  [0x25fd, 0x25fe], [0x2614, 0x2615], [0x2648, 0x2653], [0x267f, 0x267f],
  [0x2693, 0x2693], [0x26a1, 0x26a1], [0x26aa, 0x26ab], [0x26bd, 0x26be],
  [0x26c4, 0x26c5], [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x26ea, 0x26ea],
  [0x26f2, 0x26f3], [0x26f5, 0x26f5], [0x26fa, 0x26fa], [0x26fd, 0x26fd],
  [0x2705, 0x2705], [0x270a, 0x270b], [0x2728, 0x2728], [0x274c, 0x274c],
  [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797],
  [0x27b0, 0x27b0], [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50],
  [0x2b55, 0x2b55], [0x1f004, 0x1f004], [0x1f0cf, 0x1f0cf], [0x1f18e, 0x1f18e],
  [0x1f191, 0x1f19a], [0x1f200, 0x1f265],
]

/* Terminal cells a character takes on its own: none for a combining mark or
   variation selector, two for East Asian wide and emoji ranges. */
function cellWidth(character: string): number {
  const codePoint = character.codePointAt(0) ?? 0
  if (joinsPrevious(character)) return 0
  if (WIDE_SYMBOLS.some(([first, last]) => codePoint >= first && codePoint <= last)) return 2
  if (
    codePoint >= 0x1100 && (
      codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
      (codePoint >= 0x20000 && codePoint <= 0x3fffd)
    )
  ) return 2
  return 1
}

/* What draws on the cell of the character before it: combining marks of
   every script, variation selectors among them, the zero width joiner, skin
   tones and tag characters. */
function joinsPrevious(character: string): boolean {
  const codePoint = character.codePointAt(0) ?? 0
  return /\p{M}/u.test(character)
    || codePoint === 0x200d
    || (codePoint >= 0x1f3fb && codePoint <= 0x1f3ff)
    || (codePoint >= 0xe0020 && codePoint <= 0xe007f)
}

function isRegionalIndicator(codePoint: number): boolean {
  return codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff
}

/* The text in the units a terminal draws, each with its cells, in order: a
   character with the marks it carries (a spacing mark takes a cell of its
   own); an emoji joined to the next by ZWJ; two regional indicators, a flag.
   One asked to draw as emoji (U+FE0F), a flag and a joined sequence take two
   cells. A unit is handed on once the next one starts. */
function* clusters(text: string): Generator<{ text: string; cells: number }> {
  let unit: { text: string; cells: number; joined: boolean; flag: boolean } | undefined
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0
    if (unit !== undefined && (unit.joined || joinsPrevious(character)
        || (isRegionalIndicator(codePoint) && unit.flag))) {
      unit.text += character
      unit.joined = codePoint === 0x200d
      if (codePoint === 0xfe0f || codePoint === 0x200d || isRegionalIndicator(codePoint)) unit.cells = 2
      else if (/\p{Mc}/u.test(character)) unit.cells += 1
      unit.flag = false
      continue
    }
    if (unit !== undefined) yield unit
    unit = { text: character, cells: cellWidth(character), joined: false, flag: isRegionalIndicator(codePoint) }
  }
  if (unit !== undefined) yield unit
}

/* Terminal cells a text takes. */
export function textCells(text: string): number {
  let width = 0
  for (const unit of clusters(text)) width += unit.cells
  return width
}

/* A Button label cut to the cells it is drawn in, so it stays on one row:
   read only as far as the cut. */
export function clipCells(text: string, columns: number): string {
  let width = 0
  let clipped = ''
  let cut = false
  for (const unit of clusters(text)) {
    width += unit.cells
    if (width > columns) return `${clipped}…`
    if (width > Math.max(1, columns - 1)) cut = true
    if (!cut) clipped += unit.text
  }
  return text
}
