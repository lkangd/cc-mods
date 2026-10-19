# Decide the first release's form and docs

Type: grilling
Status: resolved
Blocked by: 

## Question

How is chat-toc's first version released and documented: how the marketplace entry is written (name, description, category, and how to say, next to prompt-history, that the two are independent and can be enabled together); what the new section of the root README says, which must include the not-promised list of "Finalise the compatibility and acceptance contract", the minimum version `>=2.1.287`, docking in fullscreen only, and reading the status line note when it cannot dock; whether `mods/chat-toc/` needs a README of its own and what it says (the three Layouts, the View filter, hotkeys 1/2/3, `l`, ↑↓/Enter, `/chat-toc`); what the first version number is and how it matches the `mods/chat-toc/tests/evidence/<plugin version>/` report folder. The release approach of prompt-history 0.3.0 and the root README's current structure can be borrowed.

## Answer

**Verdict: the first version is `0.1.0`; the root README holds the only user doc, and `mods/chat-toc/README.md` covers only development and release; the marketplace entry, the README section and the evidence report go into one release commit after every MUST passes, with no tag.** Confirmed item by item with the user in two rounds on 2026-10-09.

### 1. Version number and the evidence folder

- The first version is `0.1.0`. It is written in both `plugin.json` and the marketplace entry (the manifest's `version` takes priority).
- One folder per version: `mods/chat-toc/tests/evidence/<version>/`. Every version bump reruns the full MUST gate into a new folder, and old folders stay untouched; the report records the commit hash tested.
- Three files go in the folder: `report.md` (for people, including the signed visual check), `report.json` (fields as in §6 of "Finalise the compatibility and acceptance contract"), and `marketplace.md` (the results of the local-folder marketplace smoke plus the GitHub install-level check). The two Claude Code versions go in one report, in separate columns.
- No CHANGELOG is kept: the version history is the evidence folders plus the commit log.

### 2. The marketplace entry

```json
{
  "name": "chat-toc",
  "source": "./mods/chat-toc",
  "description": "A docked table of contents of the current Claude Code session; jump to any turn.",
  "version": "0.1.0",
  "author": { "name": "chat-toc contributors" }
}
```

No `category`/`tags` (with only two plugins a category has no use, and prompt-history has none either). The entry does not mention prompt-history; independence is stated only in the README.

### 3. The release steps

- The marketplace reads main on GitHub, so an entry landing in main is the release.
- The plugin code can be merged into main first, but the marketplace entry, the row in the root README's overview table and the chat-toc section, and the `evidence/0.1.0/` report go in **one release commit**, committed last, after every MUST passes. No git tag.
- The `CT-COMPAT-002` smoke runs before release against a **local-folder marketplace**, on both versions. After the release commit is pushed, an install-level check runs from `lkangd/cc-mods` (add, install, version number, enabled, Pane opens), and its result is added to `marketplace.md`. Adding it does not count as a new release; if the check fails, the release commit is withdrawn. The reason: a local-folder marketplace runs the source folder directly, and only a GitHub remote marketplace copies into a cache (a finding of prompt-history 0.3.0).

### 4. The root README

- The opening paragraph becomes: each mod is an independent plugin, with no dependence on the others and no shared code or data, and they can be enabled together.
- The overview table gains a row: `chat-toc | 0.1.0 | Docks the current session's contents on the right of the conversation; click to jump back to any turn`.
- The chat-toc section sits at the same level as the prompt-history section, with an opening sentence on how the two differ: chat-toc saves nothing and shows only the current session; prompt-history saves an archive of prompt text; both can be enabled together, one above the prompt and one docked on the right.
- Inside the section, in order:
  1. a sentence on what it does;
  2. **Requirements**: `>=2.1.287` (`claude --version`), an interactive terminal, the fullscreen layout, a terminal wide enough; `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` is not needed; any OS, tried only on macOS;
  3. **Install**: the marketplace or `--plugin-dir`, one of the two, not both at once;
  4. **Quick start**: the Pane docks on the right by itself; if it does not appear, read the status line note;
  5. **Controls**: a table listing a click on the user side and the Agent side, ↑↓/Enter when focused, 1/2/3, `l` and the "Layout:" button, ✕ closing for this session, `/chat-toc` (open, bring forward, focus, never close);
  6. **What it shows**: each entry is one turn of the conversation (your one input plus the Agent's reply), and "N steps", "Running", "No text reply", the time not shown when it cannot be read, why a dimmed entry cannot be jumped to, the cyan highlight following the place in the conversation, "paused" shown during a manual scroll, how it behaves after `/clear`/compaction/rewind; the on-screen words are Chinese;
  7. **Data and privacy**: it reads only the current session's transcript, builds no archive, and does not touch the network; `$.store` holds only the View filter and the Layout;
  8. **Uninstall**: `claude plugin uninstall chat-toc@cc-mods`, and the location of the `$.store` file left behind;
  9. **Known limits**: the seven items of the contract's §5 not-promised list, rewritten in the user's terms;
  10. **Development**: one line linking to `mods/chat-toc/README.md` and the evidence folder, with the 0.1.0 pass result.
- The README does not use internal terms such as Turn group or Current position, only the words on the screen.

### 5. `mods/chat-toc/README.md`

Developer content only: links to the root README and `CONTEXT.md`; the folder layout; local loading; how to run `claude plugin test`; how to run the cmux PTY acceptance; the evidence folder convention; and a **release checklist**, ticked in order: run every MUST on both versions → local-folder marketplace smoke → signed visual check → release commit → GitHub install-level check → withdraw on failure.

### Other

`CONTEXT.md` is not changed (these are release and docs words, not domain terms); no ADR is written (it is cheap to change). There is no new fog and no new ticket.

## Later revisions

- 2026-10-10: the not-promised list gains "the inline form when `/chat-toc` opens it by request is not accepted", so the README's known limits become eight items. See the later revisions of "Finalise the compatibility and acceptance contract".
