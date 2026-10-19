export type Query = string

declare module 'claude-code' {
  interface PluginState {
    'input-probe': { query: string; forced: string | null; rev: number }
  }
}
