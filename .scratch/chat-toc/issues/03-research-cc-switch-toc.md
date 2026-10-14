# Research the details of cc-switch's conversation contents

Type: research
Status: resolved
Blocked by: 

## Question

What are the implementation details of the "conversation contents" on the right of cc-switch's (https://github.com/farion1231/cc-switch) session details page: how messages group into turns, how "N steps" is counted, which text the Agent side takes, what the red dot and other state marks mean, what each of the "All / Conversation / Changes" switches filters, how the current position bar (scroll-spy) is computed, scrolling and highlighting after a click, the truncation rules, and how special rows like slash commands (such as "ran /login") and interruptions are handled. Take only the interaction rules useful for a terminal Pane, noting where in the source they are.

## Answer

The research document is `docs/research/chat-toc/03-cc-switch-toc.md` on branch `research/chat-toc-cc-switch-toc` (commit 90a38cd, not merged), based on cc-switch commit `2db86e94da13365caae55bb08d09295e31500d21`.

- **Grouping**: a user message that is not injected and carries text, images or a slash command opens a new turn; interruptions, `!cmd`, tool results alone and `<local-command-*>` join the current turn. Only a turn with a question, a final reply, steps or an interruption goes into the contents.
- **N steps**: the number of merged steps, a tool, thinking, process text, an image or an intermediate event counting 1 each; ≥2 consecutive successes of the same MCP merge into 1 step; 0 is not shown. The body's "process · N steps" counts tools only, so the two counts disagree.
- **Agent text**: the Text blocks after the turn's last tool_call; a last tool after all the text means no final reply.
- **Red dot**: the turn was interrupted, or any tool step errored or was interrupted. An empty reply says, in italics, "Interrupted" or "No reply".
- **All / Conversation / Changes**: filter the body only; the contents always hold every turn; a click on a filtered-out turn silently does nothing (a counter-example).
- **Scroll-spy**: each render takes the turn of the virtual row 8px below the viewport's top, and within 24px of the bottom forces the last turn; a 2px bar on the left with a light background.
- **Click**: "you" jumps to the question; the Agent side to the final reply, or failing that the Agent side's first row, then the turn's first row; aligned to the viewport's top with a focus ring flashing for 2 seconds; j/k jump between turns.
- **Truncation**: code blocks, images and Markdown marks removed and whitespace collapsed, then cut at 160 characters, CSS limiting it to 2 lines; images only show "(image only)".
- **Slash commands**: open a new turn, but the contents do not show the command's text, and with no output it stays out of the contents (**unlike this map's decision that slash commands are User input**; left to the Turn group ticket).
- **Long sessions**: the body is virtualised; the contents are not, rendered in full.

What it suggests for this mod (the researcher's inference): one way to count steps only; entries filtered out or not jumpable must be perceptible (such as greyed); truncation must count CJK as double width.
