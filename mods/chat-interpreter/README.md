# Chat Interpreter

Translate user prompts before Claude receives them and show translated final replies without changing the conversation's original reply.

## Use

Install from this repository's marketplace with `claude plugin install chat-interpreter@cc-mods`, or load the plugin locally with `claude --plugin-dir ./mods/chat-interpreter`. Run `/chat-interpreter` to open its settings pane. Processing switches start off. The active settings scope starts at **Project**; choosing **Global** switches to an independent settings set. Both the values and the active choice persist between sessions.

Set `DEEPSEEK_API_KEY` in the environment of the Claude Code process before enabling input or output translation. The plugin uses DeepSeek's `deepseek-chat` chat-completions endpoint. The key is not stored by the plugin. Punctuation conversion works without the key.

Input translation changes the prompt stored in the conversation. When input translation fails, **Send input only after successful translation** keeps the original text in the composer instead of sending it. This setting starts on. The final agent answer is translated only for display. The original answer remains available to Claude. The display shows both languages by default; **Show original text** turns the second copy off.

**Output translation** starts in Automatic mode. Switch it to Manual to show a **Translate reply** button below each eligible new final agent reply. The first press translates to the output target language. Subsequent presses hide or show the saved translation. A resumed conversation displays its cached translation and retains the button. If the result is identical, the reply stays visible once with a note. **Translate agent output** must be enabled for either mode.

When **Show original text** is on, **Original text divider** controls how the original is separated for both inputs and replies. Choose **Box** (the default), **Double line**, or **None**. A translated skill invocation keeps its command line in the transcript and shows the original arguments above the agent's first text reply.

Choose **English** or **Chinese** independently as the input and output target languages. The default input target is English and the default output target is Chinese. Punctuation conversion follows the corresponding target. Submitted slash commands stay intact. For skills identified from a `SKILL.md` in the user or project settings directories or the installed plugin index, Chat Interpreter processes only the arguments after the skill name. The expanded skill body stays intact. When input or skill argument translation is blocked, use **Send anyway** to send the original. For drafts with attachments or file mentions, the button arms the bypass and Enter submits the original draft with its contents intact.

Translation history uses JSON files under `chat-interpreter-cache` in the Claude Code configuration directory. It keeps input translations and final replies from this version onward. Cached output is looked up by conversation, message and target language. Cleanup runs when opening a conversation and after writes. It deletes files older than six calendar months and, after 1 GB, drops the oldest files until 900 MB or less remains. Cleanup on macOS and Linux uses the host's `rm` command. The cache contains conversation text. Delete the cache directory to remove it immediately.

Code fences, inline code, paths, and URLs are preserved. In Automatic mode, the final answer appears in its original language while it streams, then changes after translation completes.

Interface translation requires an interactive Claude Code terminal, the Claude Desktop Code tab, or a supported VS Code extension. `claude -p`, the Agent SDK, and cloud sessions do not show mod-drawn translations.
