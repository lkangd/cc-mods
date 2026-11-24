export type TargetLanguage = string
export type Scope = 'project' | 'global'
export type OutputMode = 'automatic' | 'manual'
export type OriginalStyle = 'box' | 'doubleRule' | 'none'

export type Settings = {
  translateInput: boolean
  outputMode: OutputMode
  inputTarget: TargetLanguage
  outputTarget: TargetLanguage
  sendOnlyOnSuccess: boolean
  showOriginal: boolean
  originalStyle: OriginalStyle
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  translateInput: false,
  outputMode: 'manual',
  inputTarget: 'en',
  outputTarget: 'zh',
  sendOnlyOnSuccess: true,
  showOriginal: true,
  originalStyle: 'box',
})

export function validTarget(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value)
}

export function readPreferences(value: unknown): Partial<Settings> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const source = value as Record<string, unknown>
  const preferences: Partial<Settings> = {}
  for (const field of ['translateInput', 'sendOnlyOnSuccess', 'showOriginal'] as const) {
    if (typeof source[field] === 'boolean') preferences[field] = source[field]
  }
  for (const field of ['inputTarget', 'outputTarget'] as const) {
    if (validTarget(source[field])) preferences[field] = source[field].trim()
  }
  // The former output switch took precedence over the saved mode.
  if (source.translateOutput === false) preferences.outputMode = 'manual'
  else if (source.outputMode === 'manual' || source.outputMode === 'automatic') preferences.outputMode = source.outputMode
  else if (source.translateOutput === true) preferences.outputMode = 'automatic'
  if (source.originalStyle === 'box' || source.originalStyle === 'doubleRule' || source.originalStyle === 'none') {
    preferences.originalStyle = source.originalStyle
  }
  return preferences
}

export function normalizeSettings(value?: unknown): Settings {
  return { ...DEFAULT_SETTINGS, ...readPreferences(value) }
}

export function projectKey(root: string): string {
  return `settings:overrides:${root}`
}

export function settingsKey(scope: Scope, root: string): string {
  return scope === 'global' ? 'settings:defaults' : projectKey(root)
}

// Retain the old defaults so unopened projects can migrate against the same baseline.
export const LEGACY_GLOBAL_KEY = 'settings:global'

export function systemIsChinese(locales: readonly (string | undefined)[]): boolean {
  const locale = locales.find(value => typeof value === 'string' && value.trim())
  return typeof locale === 'string' && /^zh(?:[_-]|$)/i.test(locale)
}
