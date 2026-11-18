import type { TargetLanguage } from './config'

export type InputTranslation = { original: string; sent: string; target: TargetLanguage }
export type Reply = { original: string; anchor: string; rows: string[] }
export type CacheRecord =
  | { kind: 'input'; row: string; value: InputTranslation }
  | { kind: 'reply'; row: string; value: Reply }
  | { kind: 'output'; row: string; target: TargetLanguage; translated: string }

const CACHE_NAME = /^[\w-]+\.[\w-]+\.(?:input|reply|output-(?:en|zh))\.json$/
const HIGH_WATER = 1_000_000_000
const LOW_WATER = 900_000_000

export function cacheName(session: string, record: CacheRecord): string | undefined {
  const kind = record.kind === 'output' ? `output-${record.target}` : record.kind
  const name = `${session}.${record.row}.${kind}.json`
  return CACHE_NAME.test(name) ? name : undefined
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function decodeCache(text: string): CacheRecord | undefined {
  const record: unknown = JSON.parse(text)
  if (!object(record) || typeof record.row !== 'string') return undefined
  if (record.kind === 'output' && (record.target === 'zh' || record.target === 'en') && typeof record.translated === 'string') {
    return { kind: 'output', row: record.row, target: record.target, translated: record.translated }
  }
  const value = record.value
  if (!object(value) || typeof value.original !== 'string') return undefined
  if (record.kind === 'input' && typeof value.sent === 'string' && (value.target === 'zh' || value.target === 'en')) {
    return { kind: 'input', row: record.row, value: { original: value.original, sent: value.sent, target: value.target } }
  }
  if (record.kind === 'reply' && value.anchor === record.row && Array.isArray(value.rows)
      && value.rows.every(row => typeof row === 'string') && value.rows.includes(record.row)) {
    return { kind: 'reply', row: record.row, value: { original: value.original, anchor: value.anchor, rows: value.rows } }
  }
  return undefined
}

type CacheFile = { name: string; kind: string; size: number; mtimeMs: number; isLink: boolean }

export function expiryCutoff(now: number): number {
  const cutoff = new Date(now)
  const day = cutoff.getUTCDate()
  cutoff.setUTCDate(1)
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 6)
  const daysInMonth = new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0)).getUTCDate()
  cutoff.setUTCDate(Math.min(day, daysInMonth))
  return cutoff.getTime()
}

export function planCacheCleanup(files: readonly CacheFile[], now: number): { remove: string[]; keep: string[] } {
  const sorted = files.filter(file => file.kind === 'file' && !file.isLink && CACHE_NAME.test(file.name))
    .sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name))
  const cutoff = expiryCutoff(now)
  const remove = sorted.filter(file => file.mtimeMs < cutoff).map(file => file.name)
  const fresh = sorted.filter(file => file.mtimeMs >= cutoff)
  let bytes = fresh.reduce((total, file) => total + file.size, 0)
  let first = 0
  if (bytes > HIGH_WATER) {
    while (bytes > LOW_WATER && first < fresh.length) {
      const file = fresh[first++]!
      bytes -= file.size
      remove.push(file.name)
    }
  }
  return { remove, keep: fresh.slice(first).map(file => file.name) }
}
