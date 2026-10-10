export type Tick = number

declare module "claude-code" {
  interface PluginState {
    "toc-coex": { tick: Tick; closed: boolean }
  }
}
