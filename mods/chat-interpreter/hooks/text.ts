import type { TargetLanguage } from './config'

const TECHNICAL = /\b[A-Za-z][A-Za-z0-9+.-]*:[^\s<>()[\]]+|(?:@?\.\.?\/|~\/|\/)[\w.@+~/-]+|\b@?(?:[\w.-]+\/)+[\w.-]+\b|\b[A-Za-z]:\\(?:[^\s\\]+\\)*[^\s\\]+|(?<![\w.])(?:\.?[\w-]+)(?:\.[\w-]+)+(?![\w])/g
const IMAGE_REFERENCE = /\[Image #\d+\]/

export function hasImageReference(text: string): boolean {
  return IMAGE_REFERENCE.test(text)
}

export type TextPart = { text: string; protected: boolean }

export function splitProtected(text: string, mergeAdjacent = true): TextPart[] {
  const ranges: Array<[number, number]> = []
  const protect = (start: number, end: number): void => { if (end > start) ranges.push([start, end]) }
  for (const match of text.matchAll(new RegExp(IMAGE_REFERENCE.source, 'g'))) {
    protect(match.index, match.index + match[0].length)
  }

  const fenceOpen = /^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/gm
  for (const match of text.matchAll(fenceOpen)) {
    const opener = match[1]!
    const start = match.index
    if (ranges.some(([from, to]) => start >= from && start < to)) continue
    const bodyStart = start + match[0].length
    const closer = new RegExp(`^ {0,3}${opener[0]}{${opener.length},}[ \\t]*(?:\\n|$)`, 'gm')
    closer.lastIndex = bodyStart
    const close = closer.exec(text)
    protect(start, close ? close.index + close[0].length : text.length)
  }

  for (const match of text.matchAll(/`+/g)) {
    const start = match.index
    if (ranges.some(([from, to]) => start >= from && start < to)) continue
    const width = match[0].length
    const close = new RegExp(`(?<!\`)\`{${width}}(?!\`)`, 'g')
    close.lastIndex = start + width
    const found = close.exec(text)
    if (found && !ranges.some(([from, to]) => found.index >= from && found.index < to)) protect(start, found.index + width)
  }

  for (const match of text.matchAll(/\[([^\]\n]+)\]\(([^)\n]+)\)/g)) {
    const start = match.index
    const label = match[1]!
    protect(start, start + 1)
    protect(start + label.length + 1, start + match[0].length)
  }
  for (const match of text.matchAll(TECHNICAL)) {
    const value = match[0].replace(/[.,!?;:，。！？；：]+$/, '')
    protect(match.index, match.index + value.length)
  }

  ranges.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const [start, end] of ranges) {
    const last = merged.at(-1)
    if (last && (start < last[1] || (mergeAdjacent && start === last[1]))) last[1] = Math.max(last[1], end)
    else merged.push([start, end])
  }
  const parts: TextPart[] = []
  let from = 0
  for (const [start, end] of merged) {
    if (start > from) parts.push({ text: text.slice(from, start), protected: false })
    parts.push({ text: text.slice(start, end), protected: true })
    from = end
  }
  if (from < text.length) parts.push({ text: text.slice(from), protected: false })
  return parts
}

/** Split at host image references outside other protected spans, such as code. */
export function splitImageReferences(text: string): TextPart[] {
  if (!hasImageReference(text)) return [{ text, protected: false }]
  const chunks: TextPart[] = []
  let draft = ''
  for (const part of splitProtected(text, false)) {
    if (part.protected && /^\[Image #\d+\]$/.test(part.text)) {
      if (draft) chunks.push({ text: draft, protected: false })
      chunks.push(part)
      draft = ''
    } else {
      draft += part.text
    }
  }
  if (draft) chunks.push({ text: draft, protected: false })
  return chunks
}

const ZH_TO_EN = new Map([
  ['，', ','], ['。', '.'], ['！', '!'], ['？', '?'], ['；', ';'], ['：', ':'], ['、', ','],
  ['（', '('], ['）', ')'], ['【', '['], ['】', ']'], ['“', '"'], ['”', '"'], ['‘', "'"], ['’', "'"],
])
const EN_TO_ZH = new Map([
  [',', '，'], ['.', '。'], ['!', '！'], ['?', '？'], [';', '；'], [':', '：'],
  ['(', '（'], [')', '）'], ['[', '【'], [']', '】'],
])

export function convertPunctuation(text: string, target: TargetLanguage): string {
  const direction = target === 'en' ? 'zh-en' : 'en-zh'
  const table = direction === 'zh-en' ? ZH_TO_EN : EN_TO_ZH
  let doubleQuoteOpen = true
  let singleQuoteOpen = true
  return splitProtected(text).map(part => {
    if (part.protected) return part.text
    return part.text.replace(/[，。！？；：、（）【】“”‘’.,!?;:()\[\]"']/g, (mark, index, source) => {
      if (direction === 'en-zh' && mark === '.' && /\d/.test(source[index - 1] ?? '') && /\d/.test(source[index + 1] ?? '')) return mark
      if (direction === 'en-zh' && mark === '"') {
        const converted = doubleQuoteOpen ? '“' : '”'
        doubleQuoteOpen = !doubleQuoteOpen
        return converted
      }
      if (direction === 'en-zh' && mark === "'") {
        if (/[A-Za-z]/.test(source[index - 1] ?? '') && /[A-Za-z]/.test(source[index + 1] ?? '')) return mark
        const converted = singleQuoteOpen ? '‘' : '’'
        singleQuoteOpen = !singleQuoteOpen
        return converted
      }
      return table.get(mark) ?? mark
    })
  }).join('')
}

export function hasTranslatableText(text: string): boolean {
  return splitProtected(text).some(part => !part.protected && /\p{L}/u.test(part.text))
}

export function maskProtected(text: string): { masked: string; values: Array<[string, string]> } {
  let index = 0
  const values: Array<[string, string]> = []
  const masked = splitProtected(text).map(part => {
    if (!part.protected) return part.text
    let marker = `__CI_KEEP_${index++}__`
    while (text.includes(marker)) marker = `__CI_KEEP_${index++}__`
    values.push([marker, part.text])
    return marker
  }).join('')
  return { masked, values }
}

export function restoreProtected(translated: string, values: ReadonlyArray<readonly [string, string]>): string {
  let restored = translated
  for (const [marker, value] of values) {
    if (restored.split(marker).length !== 2) throw new Error('Protected text was changed by the translation service')
    restored = restored.replace(marker, () => value)
  }
  return restored
}
