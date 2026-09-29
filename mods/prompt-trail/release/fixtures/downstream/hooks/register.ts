// Release fixture, loaded only by PTY scenarios beside Prompt Trail. It sits
// beneath Prompt Trail in the prompt.submit chain: a prompt carrying
// PT-FIXTURE-DROP is refused, one carrying PT-FIXTURE-HOLD waits before it
// goes on, so a scenario can act between Prompt Trail's pre-write and its
// confirmation. Every other prompt passes untouched.
import type { Register } from 'claude-code'

export const register: Register = (on) => {
  on('prompt.submit', async ($, e, next) => {
    if (e.text.includes('PT-FIXTURE-DROP')) return { drop: 'dropped by the release fixture' }
    if (e.text.includes('PT-FIXTURE-HOLD')) {
      // 2.1.273 gives a hook no budget to read; its wait is then a fixed five seconds.
      const room = next.budget?.remainingMs
      await $.clock.sleep(room === undefined ? 5_000 : Math.max(0, Math.min(8_000, room - 2_000)), {
        signal: next.signal,
      })
    }
    return next(e)
  })
}
