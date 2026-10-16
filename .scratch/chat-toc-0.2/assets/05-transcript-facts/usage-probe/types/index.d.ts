export type Probe = string

declare module 'claude-code' {
  interface PluginState {
    'usage-probe': { n: number }
  }
}
