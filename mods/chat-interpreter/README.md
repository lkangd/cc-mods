# chat-interpreter

Translate prompts before Claude receives them, and display translations of final replies. Input and output languages can be configured independently.

## Requirements

- An interactive Claude Code terminal, the Claude Desktop Code tab, or a supported VS Code extension.
- For translation, bring a model API, a translation API, or an installed local translation CLI. CLI connections require a surface that supports local processes.
- Provisioning a credential or private endpoint requires Python 3.8 or newer. On native Windows use an ACL-capable filesystem such as NTFS, and install pywin32 for the helper's interpreter with `py -3 -m pip install pywin32`. The helper creates directories with a protected, inheritable ACL granting access only to your Windows account.

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

1. Run `/chat-interpreter` to open the settings pane. The **Global** tab edits defaults for all projects. The **Project** tab shows the effective values for this project. Editing a project setting overrides that field. Choose **Use global** beside an override to restore inheritance. Switching tabs only changes the view.
2. Run `/chat-interpreter:setup` in the conversation and describe the service or CLI you already have. For a private service, give the model a sanitized local document or example request with placeholders. For a CLI, setup can inspect its help and prepare a local adapter when needed.
3. Choose whether to translate input, whether replies use **Manual** or **Automatic** mode, and whether to save these preferences globally or for this project. You can use any target language separately for each direction. Setup suggests English for input and the language of your prompt for output. The service detects the source for each message.
4. If credentials or a private endpoint are needed, run the command setup gives you in a separate terminal and return to the same conversation. Use `--from-env PROVIDER_KEY` in the terminal where that variable is set to copy its value to the candidate's private file, or let the helper prompt privately. Keep keys and private addresses out of the conversation.
5. Review each synthetic source and its extracted translation. Setup tries each distinct automatic target once. With input translation off and manual replies, it tries the reply target once. Confirm the samples and scope to save. The connection is shared across projects. The choices for input and output apply to the scope shown in the review.

Run setup again to replace a connection. Automatic translations pause in the interviewing session. Other sessions can continue with the saved connection until confirmation. Type `/chat-interpreter:setup cancel` to leave immediately.

## Usage

### Input translation

Input translation changes the prompt stored in the conversation. When translation fails, **Send input only after successful translation** keeps the original text in the composer. This setting starts on. Use **Send anyway** to send the original. For drafts with attachments or file mentions, press **Send anyway**, then press Enter to submit the original draft with its contents intact.

Submitted slash commands stay intact. For skills identified from a `SKILL.md` in the user or project settings directories or the installed plugin index, Chat Interpreter processes only the arguments after the skill name. The expanded skill body stays intact.

### Output translation

Output translation affects the display, and Claude retains the original reply. The default mode is **Manual**. In **Automatic** mode, the final reply appears in its original language while it streams and changes after translation completes. In the fullscreen terminal, **Jump to translation** under the reply takes you to the beginning of the translation. Claude Code requires a click to scroll the transcript.

In **Manual** mode, a **Translate reply** button appears below each eligible agent reply after the turn ends, including earlier replies from the same turn. When you resume a conversation, visible reply text blocks without a saved reply record also get a button. The first press translates the selected reply or text block. Subsequent presses hide or show the saved translation. A resumed conversation displays its cached translation and retains the button. If both texts are identical, the reply appears once with a note.

### Bilingual display

**Show original text** is on by default. **Original text divider** separates the original text from the translation for both inputs and replies. Choose **Box** (the default), a full-width **Double line**, or **None**.

A translated skill invocation shows the original arguments as a separate transcript notice below the command, before the agent starts. The notice uses the host's style and remains in the transcript after settings change. Claude Code also includes notices in its debug log when enabled.

Code fences, inline code, paths, and URLs are preserved during translation.

## Data and privacy

The confirmed service or CLI receives text when a translation is requested. Request descriptions, executable paths and credential references live in the plugin’s user-wide store. The provisioning helper writes credentials and private endpoints to user-only files under `chat-interpreter/credentials` in the Claude Code configuration directory. A CLI can also use its own installed credentials. Connection changes preserve previously cached translations.

Translation history is stored in JSON files under `chat-interpreter-cache` in the Claude Code configuration directory. It contains input translations and saved reply records. Cached output is looked up by conversation, message, and target language. Cleanup runs when opening a conversation and after writes. It deletes files older than six calendar months. Once the cache exceeds 1 GB, it drops the oldest files until 900 MB or less remains. On macOS and Linux, cleanup uses the host's `rm` command.

## Known limits

`claude -p`, the Agent SDK, and cloud sessions do not show translations drawn by the plugin.

## Uninstall

```sh
claude plugin uninstall chat-interpreter@cc-mods
```

For a local load, start Claude Code without `--plugin-dir ./mods/chat-interpreter`.

To remove saved translations, delete the `chat-interpreter-cache` directory in the Claude Code configuration directory. To erase private credentials and endpoints provisioned by setup, remove its `chat-interpreter/credentials` directory there.

## Development

See [CONTEXT.md](CONTEXT.md) for domain terms.

Run the automated tests and validate the plugin from the repository root.

```sh
claude plugin test mods/chat-interpreter
claude plugin validate mods/chat-interpreter
python3 -m unittest discover -s mods/chat-interpreter/tests
```
