export type Ver = number

declare module 'claude-code' {
  interface PluginState {
    'toc-btn': { ver: Ver }
  }
}
