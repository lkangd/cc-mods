# cc-mods

A collection of Claude Code mods. Each mod is an independent plugin under `mods/` and can be enabled alongside the others.

## Mods

| Mod | Version | What it does |
| --- | --- | --- |
| [chat-toc](mods/chat-toc/README.md) | 0.2.0 | Adds a table of contents for the current session and lets you jump to a turn in the terminal. |
| [chat-interpreter](mods/chat-interpreter/README.md) | 0.6.3 | Translates submitted prompts and displays final replies in two languages. |

## Install

Register the marketplace once.

```sh
claude plugin marketplace add lkangd/cc-mods
```

Run the install command for each plugin you want.

```sh
claude plugin install chat-toc@cc-mods
claude plugin install chat-interpreter@cc-mods
```

Run `claude plugin list` to check which plugins are enabled, then start a new Claude Code session. See each plugin's README for requirements and setup.
