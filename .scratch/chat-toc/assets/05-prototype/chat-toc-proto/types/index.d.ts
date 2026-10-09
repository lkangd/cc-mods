export type Variant = string

declare module 'claude-code' {
  interface PluginState {
    'chat-toc-proto': { cp: number; ver: number; closed: boolean; path: string; note: string }
  }
}
