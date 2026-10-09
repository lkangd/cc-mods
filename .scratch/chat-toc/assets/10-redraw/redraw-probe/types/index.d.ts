export type Cp = number

declare module 'claude-code' {
  interface PluginState {
    'redraw-probe': { cp: Cp }
  }
}
