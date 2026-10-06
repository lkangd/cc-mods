# Prompt Trail

Prompt Trail provides an in-terminal timeline of prompts entered during the current Claude Code run so people can return to earlier conversation points.

## Language

**Prompt Trail**:
The navigable timeline of human-entered prompts collected during the current run.
_Avoid_: Prompt history, input history

**Run**:
The lineage of one conversation across Claude Code processes. An ordinary launch starts a run; it continues through clear boundaries and Mod reloads, and any resume of one of its sessions attaches a process to it again. At most one live process is attached to a run at a time; a fork, or a second concurrent resume, starts a new run.
_Avoid_: Module instance, session, process

**Conversation segment**:
A contiguous portion of a run bounded by the start or a clear boundary.
_Avoid_: Session

**Clear boundary**:
A non-prompt timeline marker separating the conversation segments before and after a `/clear` action.
_Avoid_: Prompt, message

**Project timeline**:
The durable chronological history associated with one project root. Different worktrees have different project timelines.
_Avoid_: Global history, session history

**Timeline event**:
An immutable occurrence in a project timeline, such as a run starting, a process attaching to or detaching from a run, a prompt being entered, or a clear boundary.
_Avoid_: Mutable message

**Prompt entry**:
A timeline event representing one composer submission whose own row the host stored in the conversation (`session.append`), or that the person reconciled as entered. It retains the complete final text plus only the count and broad kinds of any attachments, never attachment contents, names, paths, or hashes. It remains archived without a Jump target, and identical text in different entries remains distinct.
_Avoid_: Render event, deduplicated prompt, attachment archive

**Jump target**:
A temporary association from a prompt entry to its currently rendered transcript position. It is valid only while that transcript position remains available.
_Avoid_: Prompt identity, archive identifier

**Conversation branch**:
A logical lineage of prompt entries. A rewind or fork creates a new branch from an earlier prompt while preserving the previous branch.
_Avoid_: Run, conversation segment

**Active branch**:
The conversation branch aligned with one Run's current transcript. Concurrent Runs in the same project each have their own active branch.
_Avoid_: Project-wide active branch, latest events

**Collection consent**:
The person's explicit authorization for one Project Timeline to begin retaining complete prompt text. Each worktree and a project at a new canonical path requires its own consent. Before consent, Prompt Trail creates no Prompt Entries.
_Avoid_: Plugin installation, implied consent, global consent

**Run collection mode**:
Whether one Run is currently recording Prompt Entries after its Project Timeline has Collection consent. Disabling one Run does not revoke project consent or change another Run's mode.
_Avoid_: Collection consent, project-wide switch

**Collection boundary**:
A non-prompt timeline marker recording that one Run's collection began, ended, or resumed. It never claims to reconstruct prompts entered while that Run's collection was disabled.
_Avoid_: Clear boundary, inferred history

**Archive generation**:
The incarnation of a Project Timeline created by the latest clear-all or quarantine, identified by the archive file itself. A clear-all atomically retires and deletes the previous generation so concurrent Runs cannot restore deleted records, and the next write starts an empty one; a quarantine retires it into a Quarantined archive and starts an empty one at once.
_Avoid_: Run, conversation segment, the `archiveGeneration` token in locators and the session index

**Pending capture**:
A durably staged composer submission whose final entry into the Claude Code conversation has not yet been confirmed. It is not a Prompt Entry until confirmed. A submission queued behind a running turn stays one until the person reconciles it, since the host ties no stored row to it; so does one interrupted after staging.
_Avoid_: Prompt Entry, timeline gap

**Archive unavailable**:
A safety state in which Prompt Trail cannot prove that new Prompt Entries can be retained correctly. A Run-local failure blocks that Run; a shared archive failure blocks every Run using the affected Archive generation. Composer submissions remain blocked until recovery or an explicit choice to disable collection for the current Run.
_Avoid_: Silent degradation, best-effort mode

**Quarantined archive**:
An archive generation removed from active use after an integrity failure while its original database files are preserved unchanged for later recovery or deletion.
_Avoid_: Migration backup, active archive generation

**Migration backup**:
A private copy of an archive taken just before a schema migration, kept beside it until the next successful open rechecks the upgraded archive. It holds every archived prompt, is never restored automatically, and while it cannot be removed the archive stays unavailable.
_Avoid_: Quarantined archive, archive generation

**Integrity gap**:
A detected interval where Prompt Trail cannot prove that one Run's Prompt Entries and lifecycle boundaries match the Claude Code conversation, typically after a host-level fail-open or unrecoverable lifecycle write. It belongs to that Run and is deleted with that Run's records. It is shown explicitly and never treated as a complete timeline.
_Avoid_: Archive unavailable, silent omission, disabled collection interval

**Integrity recovery boundary**:
A non-prompt timeline marker ending an Integrity gap when Prompt Trail can again prove correct collection. It starts a new verifiable interval but never reconstructs, hides, or makes the preceding gap complete.
_Avoid_: Gap deletion, proof of historical completeness
