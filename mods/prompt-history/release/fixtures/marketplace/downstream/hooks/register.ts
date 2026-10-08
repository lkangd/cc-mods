// Release fixture, loaded only by PTY scenarios beside prompt-history. It sits
// beneath prompt-history in the prompt.submit chain: a prompt carrying
// PH-FIXTURE-DROP is refused, one carrying PH-FIXTURE-HOLD waits before it
// goes on, so a scenario can act between prompt-history's pre-write and its
// confirmation. Every other prompt passes untouched.
import type { Register } from 'claude-code'

export const register: Register = (on) => {
  on('prompt.submit', async ($, e, next) => {
    if (e.text.includes('PH-FIXTURE-DROP')) return { drop: 'dropped by the release fixture' }
    if (e.text.includes('PH-FIXTURE-HOLD')) {
      // 2.1.273 gives a hook no budget to read; its wait is then a fixed five seconds.
      const room = next.budget?.remainingMs
      await $.clock.sleep(room === undefined ? 5_000 : Math.max(0, Math.min(8_000, room - 2_000)), {
        signal: next.signal,
      })
    }
    return next(e)
  })
}
