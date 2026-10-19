export type Rev = number

declare module 'claude-code' {
  interface PluginState {
    'scroll-probe': { rev: number }
  }
}
