export type TargetLanguage = string
export type Scope = 'project' | 'global'
export type OutputMode = 'automatic' | 'manual'
export type OriginalStyle = 'box' | 'doubleRule' | 'none'

export type Settings = {
  punctuation: boolean
  translateInput: boolean
  translateOutput: boolean
  outputMode: OutputMode
  inputTarget: TargetLanguage
  outputTarget: TargetLanguage
  sendOnlyOnSuccess: boolean
  showOriginal: boolean
  originalStyle: OriginalStyle
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  punctuation: false,
  translateInput: false,
  translateOutput: false,
  outputMode: 'automatic',
  inputTarget: 'en',
  outputTarget: 'zh',
  sendOnlyOnSuccess: true,
  showOriginal: true,
  originalStyle: 'box',
})

export function validTarget(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value)
}

export function normalizeSettings(value?: unknown): Settings {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Partial<Settings> : {}
  return {
    punctuation: typeof source.punctuation === 'boolean' ? source.punctuation : DEFAULT_SETTINGS.punctuation,
    translateInput: typeof source.translateInput === 'boolean' ? source.translateInput : DEFAULT_SETTINGS.translateInput,
    translateOutput: typeof source.translateOutput === 'boolean' ? source.translateOutput : DEFAULT_SETTINGS.translateOutput,
    outputMode: source.outputMode === 'manual' ? 'manual' : 'automatic',
    inputTarget: validTarget(source.inputTarget) ? source.inputTarget.trim() : DEFAULT_SETTINGS.inputTarget,
    outputTarget: validTarget(source.outputTarget) ? source.outputTarget.trim() : DEFAULT_SETTINGS.outputTarget,
    sendOnlyOnSuccess: typeof source.sendOnlyOnSuccess === 'boolean' ? source.sendOnlyOnSuccess : DEFAULT_SETTINGS.sendOnlyOnSuccess,
    showOriginal: typeof source.showOriginal === 'boolean' ? source.showOriginal : DEFAULT_SETTINGS.showOriginal,
    originalStyle: source.originalStyle === 'doubleRule' || source.originalStyle === 'none' ? source.originalStyle : 'box',
  }
}

export function projectKey(root: string): string {
  return `settings:project:${root}`
}

export function activeScopeKey(root: string): string {
  return `active-scope:${root}`
}

export function settingsKey(scope: Scope, root: string): string {
  return scope === 'global' ? 'settings:global' : projectKey(root)
}

export function systemIsChinese(locales: readonly (string | undefined)[]): boolean {
  const locale = locales.find(value => typeof value === 'string' && value.trim())
  return typeof locale === 'string' && /^zh(?:[_-]|$)/i.test(locale)
}
