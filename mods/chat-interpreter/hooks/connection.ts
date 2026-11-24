import type { HttpInit } from 'claude-code'

export const CONNECTION_KEY = 'translation-connection'
type Json = string | number | boolean | null | Json[] | { [field: string]: Json }
type ResultPath = (string | number)[]
export type TranslationConnection =
  | { kind: 'http'; id: string; url: string; body: Json; resultPath: ResultPath; credential?: { header: string; prefix: string } }
  | { kind: 'cli'; id: string; program: string; args: string[]; stdin: string; resultPath: ResultPath; credential?: { env: string } }

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function json(value: unknown): value is Json {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return true
  if (Array.isArray(value)) return value.every(json)
  return object(value) && Object.values(value).every(json)
}

export function validEndpoint(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\/[^\s/@?#\\]+(?:[/?][^\s#\\]*)?$/i.test(value)
}

function hasPlaceholder(value: Json, token: string): boolean {
  if (typeof value === 'string') return value.includes(token)
  return value !== null && typeof value === 'object' && Object.values(value).some(item => hasPlaceholder(item, token))
}

export function validateConnection(value: unknown): TranslationConnection {
  const invalid = 'Invalid translation connection description.'
  if (!object(value) || typeof value.id !== 'string' || !/^[\w-]{8,64}$/.test(value.id) ||
      !Array.isArray(value.resultPath) || !value.resultPath.every(part =>
        typeof part === 'string' && part.length > 0 || typeof part === 'number' && Number.isSafeInteger(part) && part >= 0)) throw new Error(invalid)
  const { id, resultPath, credential } = value
  if (value.kind === 'http' && (value.url === 'local' || validEndpoint(value.url)) && json(value.body) &&
      hasPlaceholder(value.body, '{{text}}') && hasPlaceholder(value.body, '{{target}}')) {
    if (credential !== undefined && (!object(credential) || typeof credential.header !== 'string' ||
        !/^[a-z0-9-]+$/i.test(credential.header) || typeof credential.prefix !== 'string' || /[\r\n]/.test(credential.prefix))) throw new Error(invalid)
    return { kind: 'http', id, url: value.url, body: value.body, resultPath,
      ...(credential && { credential: { header: credential.header as string, prefix: credential.prefix as string } }) }
  }
  if (value.kind === 'cli' && typeof value.program === 'string' && /^(?:\/|[a-z]:[\\/])/i.test(value.program) &&
      Array.isArray(value.args) && value.args.every(arg => typeof arg === 'string' && !arg.includes('{{text}}')) &&
      typeof value.stdin === 'string' && value.stdin.includes('{{text}}') &&
      [value.stdin, ...value.args].some(arg => arg.includes('{{target}}'))) {
    if (credential !== undefined && (!object(credential) || typeof credential.env !== 'string' ||
        !/^[A-Za-z_][A-Za-z0-9_]*$/.test(credential.env))) throw new Error(invalid)
    return { kind: 'cli', id, program: value.program, args: value.args, stdin: value.stdin, resultPath,
      ...(credential && { credential: { env: credential.env as string } }) }
  }
  throw new Error(invalid)
}

export function fillTemplate(template: string, text: string, target: string): string {
  return template.replace(/\{\{(text|target)\}\}/g, (_, field) => field === 'text' ? text : target)
}

export function httpRequest(connection: Extract<TranslationConnection, {kind: 'http'}>, text: string, target: string, secret?: string): HttpInit {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (connection.credential && secret) headers[connection.credential.header] = connection.credential.prefix + secret
  return { method: 'POST', headers, body: JSON.stringify(connection.body, (_field, value: unknown) =>
    typeof value === 'string' ? fillTemplate(value, text, target) : value) }
}

export function extractTranslation(body: string, path: ResultPath, secret?: string): string {
  let value: unknown = body
  if (path.length) {
    try { value = JSON.parse(body) } catch { throw new Error('Translation response is not valid JSON.') }
    for (const field of path) {
      value = value !== null && typeof value === 'object' && Object.hasOwn(value, field)
        ? (value as Record<string, unknown>)[field] : undefined
    }
  }
  if (typeof value !== 'string' || !value.trim()) throw new Error('Translation result field is missing or empty.')
  if (secret && value.includes(secret)) throw new Error('The translation result contains a credential.')
  return value
}
