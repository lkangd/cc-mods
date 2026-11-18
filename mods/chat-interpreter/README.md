# Chat Interpreter

Translate user prompts before Claude receives them and show translated final replies without changing the conversation's original reply.

## Use

Install from this repository's marketplace with `claude plugin install chat-interpreter@cc-mods`, or load the plugin locally with `claude --plugin-dir ./mods/chat-interpreter`. Run `/chat-interpreter` to open its settings pane. Processing switches start off. The active settings scope starts at **Project**; choosing **Global** switches to an independent settings set. Both the values and the active choice persist between sessions.

Set `DEEPSEEK_API_KEY` in the environment of the Claude Code process before enabling input or output translation. The plugin uses DeepSeek's `deepseek-chat` chat-completions endpoint. The key is not stored by the plugin. Punctuation conversion works without the key.

Input translation changes the prompt stored in the conversation. When input translation fails, **Send input only after successful translation** keeps the original text in the composer instead of sending it. This setting starts on. The final agent answer is translated only for display. The original answer remains available to Claude. The display shows both languages by default; **Show original text** turns the second copy off.

**Output translation** starts in Automatic mode. Switch it to Manual to show a **Translate reply** button below each eligible final agent reply. The reply stays in its original language until the button is pressed. Manual translation uses the same output direction and bilingual display setting. **Translate agent output** must be enabled for either mode to translate replies.

Code fences, inline code, paths, and URLs are preserved. In Automatic mode, the final answer appears in its original language while it streams, then changes after translation completes.

Interface translation requires an interactive Claude Code terminal, the Claude Desktop Code tab, or a supported VS Code extension. `claude -p`, the Agent SDK, and cloud sessions do not show mod-drawn translations.
