export type Press = { variant: string; target: string; at: number }
export type SiteSeen = { component: string; surface: string; requestId: string; onScreen: string; at: number }

declare module 'claude-code' {
  interface PluginState {
    'toc-probe': { presses: Press[]; sites: SiteSeen[] }
  }
}
