export type Probe = string

declare module 'claude-code' {
  interface PluginState {
    'toc-perf': { cp: number; ver: number; path: string }
  }
}
