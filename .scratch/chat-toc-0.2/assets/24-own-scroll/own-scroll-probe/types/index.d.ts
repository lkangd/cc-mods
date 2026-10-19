export type Rev = number

declare module 'claude-code' {
  interface PluginState {
    'own-scroll-probe': { rev: number }
  }
}
