# chat-interpreter

Convert punctuation locally, translate prompts before Claude receives them, and display translations of final replies. Input and output languages can be configured independently.

## Requirements

- An interactive Claude Code terminal, the Claude Desktop Code tab, or a supported VS Code extension.
- For input or output translation, set `DEEPSEEK_API_KEY` in the Claude Code process environment before starting the session. Punctuation conversion works without a key.

## Install

### Marketplace

Register the marketplace once, then install the plugin.

```sh
claude plugin marketplace add lkangd/cc-mods
claude plugin install chat-interpreter@cc-mods
claude plugin list
```

Check that `chat-interpreter@cc-mods` is enabled, then start a new Claude Code session.

### Local development

From the root of a local clone, run the plugin directly in a session where the marketplace copy is disabled.

```sh
claude --plugin-dir ./mods/chat-interpreter
```

## Getting started

1. Run `/chat-interpreter` to open the settings pane.
2. Choose **Project** or **Global**. The plugin starts in **Project**. Each scope has its own settings, and both the settings and the active scope persist across sessions.
3. Enable **Convert punctuation**, **Translate user input**, or **Translate agent output** as needed. All three switches start off.
4. Choose **English** or **Chinese** independently for input and output. Input defaults to English and output defaults to Chinese. Punctuation conversion follows the corresponding target language.

## Usage

### Input translation

Input translation changes the prompt stored in the conversation. When translation fails, **Send input only after successful translation** keeps the original text in the composer. This setting starts on. Use **Send anyway** to send the original. For drafts with attachments or file mentions, press **Send anyway**, then press Enter to submit the original draft with its contents intact.

Submitted slash commands stay intact. For skills identified from a `SKILL.md` in the user or project settings directories or the installed plugin index, Chat Interpreter processes only the arguments after the skill name. The expanded skill body stays intact.

### Output translation

Output translation affects the display, and Claude retains the original reply. **Output translation** starts in **Automatic** mode. The final reply appears in its original language while it streams and changes after translation completes.

In **Manual** mode, a **Translate reply** button appears below each eligible agent reply after the turn ends, including earlier replies from the same turn. When you resume a conversation, visible reply text blocks without a saved reply record also get a button. The first press translates the selected reply or text block. Subsequent presses hide or show the saved translation. A resumed conversation displays its cached translation and retains the button. If both texts are identical, the reply appears once with a note. Enable **Translate agent output** to use either mode.

### Bilingual display

**Show original text** is on by default. **Original text divider** separates the original text from the translation for both inputs and replies. Choose **Box** (the default), a full-width **Double line**, or **None**.

A translated skill invocation shows the original arguments as a separate transcript notice below the command, before the agent starts. The notice uses the host's style and remains in the transcript after settings change. Claude Code also includes notices in its debug log when enabled.

Code fences, inline code, paths, and URLs are preserved during translation.

## Data and privacy

The plugin sends text for translation to DeepSeek's chat-completions endpoint using the `deepseek-chat` model. It reads `DEEPSEEK_API_KEY` from the process environment and never stores the key.

Translation history is stored in JSON files under `chat-interpreter-cache` in the Claude Code configuration directory. It contains input translations and saved reply records. Cached output is looked up by conversation, message, and target language. Cleanup runs when opening a conversation and after writes. It deletes files older than six calendar months. Once the cache exceeds 1 GB, it drops the oldest files until 900 MB or less remains. On macOS and Linux, cleanup uses the host's `rm` command.

## Known limits

`claude -p`, the Agent SDK, and cloud sessions do not show translations drawn by the plugin.

## Uninstall

```sh
claude plugin uninstall chat-interpreter@cc-mods
```

For a local load, start Claude Code without `--plugin-dir ./mods/chat-interpreter`.

To remove saved translations, delete the `chat-interpreter-cache` directory in the Claude Code configuration directory.

## Development

See [CONTEXT.md](CONTEXT.md) for domain terms.

Run the automated tests and validate the plugin from the repository root.

```sh
claude plugin test mods/chat-interpreter
claude plugin validate mods/chat-interpreter
```
