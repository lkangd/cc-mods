export type Seen = { id: string; c: string; p: string }

declare module 'claude-code' {
  interface PluginState {
    'rid-probe': { seen: Seen[]; page: number; last: string }
  }
}
