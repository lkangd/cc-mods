# prompt-history release evidence

**Overall: fail**

- 8 scenario(s) failed

## Identity

- commit: `059ee2de8c9139bc61574cfd2082034cd8a748a2`
- pluginVersion: `0.3.0`
- macOS: `15.8`
- architecture: `arm64`
- machine: `MacBookPro18,3`
- claudeCodeVersions: `2.1.290`
- minimumClaudeCode: `2.1.290`
- surface: `interactive terminal (pseudo-terminal, pyte emulator)`
- functionHooks: `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`
- helperSha256: `8f792afd30842d60be45edfbcecc1344eee39f03ba7159539f9d4b664734609c`
- bridgeSha256: `83d70fcbeedfc2ffa02622743727b9b036d0b9f1a26c4c104ec540ba32fe282c`
- sqliteVersionNumber: `3043002`
- python: `3.14.8`
- pyte: `0.8.2`

## Gates

- artifacts-reproducible: pass ([log](logs/build-artifacts.log))
- plugin-validate@2.1.290: pass ([log](logs/plugin-validate@2.1.290.log))
- plugin-tests@2.1.290: pass ([log](logs/plugin-tests@2.1.290.log))
- typescript: pass ([log](logs/typescript.log))
- unit-tests: pass ([log](logs/unit-tests.log))
- helper-probe: pass ([log](logs/helper-probe.log))
- protocol-mismatch-probe: pass ([log](logs/protocol-mismatch-probe.log))
- benchmark-100k: pass ([log](logs/benchmark-100k.log))
- privacy-scan: pass

## 100k benchmark

```json
{
  "events": 100000,
  "fixtureBuildSeconds": 1.1,
  "warmup": 1,
  "runs": 10,
  "machine": "MacBookPro18,3",
  "cpu": "Apple M1 Pro",
  "memoryGiB": 32,
  "macOS": "15.8",
  "sqliteVersionNumber": 3043002,
  "helperSha256": "8f792afd30842d60be45edfbcecc1344eee39f03ba7159539f9d4b664734609c",
  "results": {
    "expand": {
      "p95Ms": 42.3,
      "medianMs": 35.8
    },
    "loadNextBatch": {
      "p95Ms": 43.6,
      "medianMs": 34.6
    },
    "showNewEntry": {
      "p95Ms": 84.6,
      "medianMs": 82.4
    },
    "deepLineageFirstRead": {
      "p95Ms": 209.4,
      "medianMs": 178.0
    },
    "deepLineageExpand": {
      "p95Ms": 38.8,
      "medianMs": 38.4
    },
    "deepLineageLoadNextBatch": {
      "p95Ms": 45.1,
      "medianMs": 40.2
    }
  }
}
```

## Privacy scan

- scanned files: 67551; allowed files: 332
- argv samples: 467
- allowed by design:
  - archive SQLite files under a plugin data archives/ directory: <project>.sqlite3 with -wal, -shm, -journal and .pre-migration-vN[.partial] siblings, including quarantined copies
  - Claude Code conversation records under the config directory: projects/, history.jsonl, file-history/, paste-cache/
  - Claude Code background session records under the config directory: sessions/, daemon/, jobs/

## Leaks

- none

## Scenarios

48 pass · 8 failed · 0 missing · 0 skipped

| ID | Result | Actual |
| --- | --- | --- |
| PH-COMPAT-001 | pass | 6 pass; 2.1.290: collapsed band, supported status, no archive before consent, consent asked on the first prompt, 1 entry after it |
| PH-COMPAT-002 | pass | 11 pass; 2.1.290: Claude Code 2.1.289, the Intel build under Rosetta and a host whose bridge could publish no locator each read as unsupported target with its reason and an unchecked helper; none asked for consent or made an archive, and each prompt went through; the supported host collected; no compiler or network client started (1 samples of a helper or bridge process, none with a socket) |
| PH-COMPAT-003 | failed | 1 failed, 20 pass; 2.1.290: failed: timed out waiting for the 档案不可用 dialog |
| PH-COMPAT-004 | pass | 8 pass |
| PH-COMPAT-005 | pass | 5 pass; 2.1.290: a reload with the helper unchanged went on in the same Run; another helper held the next submission as this Run's failure with the archive unchanged and was never run; with the original back, a retry submitted it once in the same Run |
| PH-CAPTURE-001 | pass | 6 pass; 2.1.290: 1 entry at sequence 2, no pending, shown once in the band, present in the transcript |
| PH-CAPTURE-002 | pass | 4 pass; 2.1.290: 3 distinct entries at sequences [2, 3, 4] |
| PH-CAPTURE-003 | pass | 6 pass; 2.1.290: multi-line CJK/emoji/combining text archived verbatim; shown on one row with ↵ |
| PH-CAPTURE-004 | pass | 4 pass; 2.1.290: with text: 1 attachment(s) of kinds image; alone: an entry with 1 attachment(s) and only the host placeholder as text; no name or path archived |
| PH-CAPTURE-005 | pass | 4 pass; 2.1.290: /cost, /prompt-history status, /reload-plugins, /compact, /clear, /rewind created no Prompt Entry |
| PH-CAPTURE-006 | pass | 5 pass; 2.1.290: compaction rows, band redraws and a reload's replay created no Prompt Entry |
| PH-CAPTURE-007 | pass | 3 pass; 2.1.290: prompt-history stages above the fixture; a prompt dropped beneath left no entry and no pending |
| PH-CAPTURE-008 | pass | 10 pass; 2.1.290: a refused confirmation kept the pending and status reported it; the next submission confirmed it from its own stored row and handed its own text back as a draft, which then went through |
| PH-LIFE-001 | pass | 12 pass; 2.1.290: 1 Clear Boundary between the prompts; same Run, two segments, a new root branch after it; shown in the band; a /clear first thing after a restart and after --resume is a Clear Boundary too, never an Integrity gap |
| PH-LIFE-002 | pass | 4 pass; 2.1.290: no Clear Boundary, no new Run, no extra entry; the prompt after /compact continues the branch; both entries jumpable |
| PH-LIFE-003 | pass | 5 pass; 2.1.290: same Run, still expanded, each entry once and jumpable, no new entry; entering the band starts on the latest entry |
| PH-LIFE-004 | pass | 6 pass; 2.1.290: exit recorded the Run leaving; the restart got a new Run on the same generation; the old Run shows start, × entry, leaving |
| PH-BRANCH-001 | pass | 12 pass; 2.1.290: --continue and a concurrent --resume bind the shared history once and archive none of it; --continue, --resume and an in-process /resume keep the Run and go on from the session's last entry; an in-process /resume back into a session this process drew binds its history and the next prompt again; the prompt after /clear folds where it left; a resume while the Run is held branches off in a new Run |
| PH-BRANCH-002 | pass | 10 pass; 2.1.290: a background /fork archived its argument once in a new Run and branch after the shared history; --fork-session bound the shared history, marked the other fork ×, and started a Run of its own that says which Run it branched off; after /compact both forks still went on from the source's last entry, and --fork-session bound it before submitting |
| PH-BRANCH-003 | pass | 5 pass; 2.1.290: /rewind to before B: the next prompt follows A on a new branch and B, C fold where it left; Esc Esc to the start: the next prompt starts a root branch below every old entry, all kept |
| PH-BRANCH-004 | pass | 6 pass; 2.1.290: a compacted resume dropped the first submission into a focused parent Pane with the box empty; Esc put the draft back and a resubmission asked again; a click on B closed the Pane and put the draft back unsent; the next submission followed B |
| PH-JUMP-001 | pass | 3 pass; 2.1.290: Enter and a click each brought an off-screen entry into view, collapsed the band and gave typing back to the prompt box |
| PH-JUMP-002 | pass | 4 pass; 2.1.290: after a restart the old entry is × beside a jumpable twin of the same text; Enter and a click on it left the band, the transcript and the archive as they were |
| PH-UI-001 | pass | 6 pass; 2.1.290: starts as one collapsed title row; a title click opens it with the ctrl+x tab hint and folds it again; /prompt-history opens it without taking the keyboard; ctrl+x tab lands on the entry; Esc gives typing back and the band stays open; /prompt-history folds it again |
| PH-UI-002 | pass | 6 pass; 2.1.290: walked 293 stops from the latest event to the first; entries old to new, every boundary row matching the archive between its entries, each kind drawn (Run start/leave/attach, clear, collection stop/resume, Integrity gap/recovery) and branches marked; gap rows in the warning colour, other rows dimmed; the ring and view held still while batches loaded |
| PH-UI-003 | pass | 4 pass; 2.1.290: at the bottom a new entry was followed uncounted; away from it the view held while the title and the row under it counted 1 then 2; that row took the view back to both entries and cleared the count |
| PH-UI-004 | failed | 1 failed, 8 pass; 2.1.290: failed: timed out waiting for a click to fold it |
| PH-UI-005 | pass | 5 pass; 2.1.290: from the bottom, where the count row counted the rows above alone, 267 trackpad ticks reached the first event; folding and opening came back to the latest; the arrows left the bottom |
| PH-UI-006 | pass | 6 pass; 2.1.290: 100,000 events; one warm-up then ten runs each, key to frame: open p95 211 ms; a press across an earlier batch's load p95 259 ms; show a new entry p95 329 ms |
| PH-UI-007 | pass | 5 pass; 2.1.290: at 27 columns and at 21 rows the open band drew its title alone, saying space is short; at 28 and 22 its rows came back; restored, it showed the same rows and count with the ring on the same entry; a wide, combining, multi-line entry kept to one row at 30, 34 and 40 columns; while cramped the title folded and opened the band |
| PH-UI-008 | failed | 1 failed, 2 pass; 2.1.290: failed: timed out waiting for the model's AskUserQuestion dialog |
| PH-STORE-001 | pass | 5 pass; 2.1.290: a restart kept the earlier entry, the generation and consent under a new Run; a resume attached to the first Run; sequence 1..8 unbroken |
| PH-STORE-002 | pass | 6 pass; 2.1.290: two Runs submitting in turn: sequence unique and in submission order, event IDs unique, each prompt under its own Run's previous one; one Run disabled archived nothing more while the other went on along its branch |
| PH-STORE-003 | pass | 5 pass; 2.1.290: a held write lock ended in archive-busy after 8.1 s, a helper seen waiting meanwhile; for 15 s with the dialog up no helper ran; released, a retry archived and submitted the prompt once |
| PH-STORE-004 | pass | 6 pass |
| PH-STORE-005 | pass | 10 pass |
| PH-STORE-006 | pass | 15 pass; 2.1.290: damage offered its four choices for every Run of the project and held another Run before it wrote anything; a recheck with the damage standing asked again and changed nothing, and once the page was put back it passed and let the prompt the damage held at its pre-write through once and archived it once; a quarantine kept the damaged archive byte for byte and started a new generation with the prompt; a mistyped phrase removed nothing, and the phrase cleared everything and let the prompt through once |
| PH-STORE-007 | pass | 9 pass |
| PH-STORE-008 | failed | 1 failed, 4 pass; 2.1.290: failed: the cut came after the held prompt landed |
| PH-STORE-009 | pass | 5 pass; 2.1.290: two project roots kept two archives; beta's damage held beta alone while alpha went on with a ready archive; a worktree of alpha and a project moved to another path were each asked for consent again and got an archive of their own, the old one left as it was |
| PH-FAIL-001 | pass | 5 pass; 2.1.290: with the archive made immutable the pre-write failed as archive-read-only for every Run of the project; cancelled, the submission was dropped with its draft back whole, nothing staged, archived or sent; made writable again, a retry archived the next prompt |
| PH-FAIL-002 | failed | 1 failed, 5 pass; 2.1.290: failed: sqlite3.OperationalError: database is locked |
| PH-FAIL-003 | pass | 6 pass; 2.1.290: the busy archive offered only a retry and disabling the Run; a retry while busy asked again and sent nothing, once free it archived the prompt once; disabling let the prompt through unarchived behind one stop boundary, nothing from the disabled time was archived after enable, and the other Run went on along its branch |
| PH-FAIL-004 | pass | 5 pass; 2.1.290: a host killed while its submission waited on a busy archive left no pending; resumed, the Run wrote one Integrity gap and its recovery ahead of its next prompt and archived nothing of the lost one; a /clear while the archive was busy was recorded from the host's store at the next submission, ahead of it, with no gap |
| PH-FAIL-005 | pass | 6 pass; 2.1.290: the gap and its recovery stood on the band and status counted one; it stayed after a restart and a clear of another Run, and went with a clear of the Run that held it |
| PH-FAIL-006 | failed | 1 failed, 1 pass; 2.1.290: failed: timed out waiting for the reconciliation notice |
| PH-CONTROL-001 | pass | 8 pass; 2.1.290: healthy: consent, Run mode, health, project, database path and 94208 bytes; 5 Integrity gaps counted; damaged: archive-integrity with its choices; no line beyond the contract's and no prompt text in any |
| PH-CONTROL-002 | pass | 6 pass; 2.1.290: enable asked for consent first, then recorded the start; disabled, a prompt was neither archived nor staged and nothing was deleted; with a pending owed, enable settled it from its stored row, then wrote the resume, and the next prompt started its new root branch |
| PH-DELETE-001 | pass | 6 pass; 2.1.290: the confirmation counted 2 entries of this Run; cancelling removed nothing; confirming removed this Run's records and left the other Run's as they were; with a quarantined archive clear-run refused and pointed to clear-all |
| PH-DELETE-002 | pass | 6 pass; 2.1.290: the confirmation listed the quarantined archive; a mistyped phrase removed nothing; the phrase removed the active archive with its WAL/SHM and the quarantine, leaving only the two stable locks; consent and the Run mode stayed; the next prompt started a new generation with no consent question |
| PH-DELETE-003 | pass | 10 pass; 2.1.290: with nothing archived both clears answered without asking; a WAL made immutable left the clear logically done and physically unfinished, listed in the answer and in status, holding the next submission; once the WAL could go, clear-all finished without the phrase and the next prompt was archived |
| PH-DELETE-004 | pass | 4 pass; 2.1.290: both confirmations say they leave the transcript/history, filesystem snapshots and third-party backups alone and promise no SSD erasure |
| PH-SEC-001 | pass | 5 pass; 2.1.290: the scan found a planted marker and passed over the archive; the prompt stood in the archive and the band, not in status, a clear confirmation or the damage dialog; 1511 files scanned, 8 archive or host files passed over, no argv held it |
| PH-SEC-002 | failed | 1 failed, 5 pass; 2.1.290: failed: timed out waiting for the 档案不可用 dialog |
| PH-SEC-003 | pass | 6 pass; 2.1.290: directories 0700 and files 0600 after migration, quarantine, clear, creation, recovery from an unfinished clear, and in every 50 ms sample between; the migration backup stood too briefly to be sampled; its mode is the helper unit test's |
| PH-SEC-004 | failed | 1 failed, 2 pass; 2.1.290: failed: timed out waiting for the held prompt to be staged |

### PH-COMPAT-001 支持矩阵冷启动

Result: **pass**

Steps:
1. 在隔离 HOME 与空项目中启动受支持宿主
1. 查看折叠的 band 与 `/prompt-history status`
1. 检查 plugin data 下的档案目录

Expected: locator、制品摘要、helper protocol、SQLite 能力与只读握手全部成功后才请求 consent；探针不创建项目数据库或 Prompt Entry。

Actual: 6 pass; 2.1.290: collapsed band, supported status, no archive before consent, consent asked on the first prompt, 1 entry after it

Evidence:
- plugin `tests/startup.test.tsx::reports supported only after the trusted read-only preflight succeeds` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/startup.test.tsx::starts collapsed with only the prompt-history title` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- unit `helper_protocol.HelperProtocolTests.test_preflight_validates_the_locator_without_creating_an_archive`: pass ([trace](logs/unit-tests.log))
- unit `helper_protocol.HelperProtocolTests.test_read_only_probe_reports_supported_capabilities`: pass ([trace](logs/unit-tests.log))
- gate `helper-probe`: pass ([trace](logs/helper-probe.log))
- pty `PH-COMPAT-001` on 2.1.290: pass ([trace](pty/2.1.290/PH-COMPAT-001.txt))

### PH-COMPAT-002 不受支持目标

Result: **pass**

Steps:
1. 分别注入操作系统、架构、macOS 主版本、低于 2.1.290 或无法证明的 Claude Code 版本（PTY 注入 2.1.289 宿主、在 Rosetta 下运行的 x64 宿主与无法写入的 locator 目录；插件以绝对路径调用 `uname` 与 `sw_vers`，操作系统与 macOS 主版本无法从外部伪造，由 plugin test 证明）
1. 启动并查看 `status`

Expected: 不请求 consent、不创建档案、不联网或编译；`status` 显示 `unsupported target`。

Actual: 11 pass; 2.1.290: Claude Code 2.1.289, the Intel build under Rosetta and a host whose bridge could publish no locator each read as unsupported target with its reason and an unchecked helper; none asked for consent or made an archive, and each prompt went through; the supported host collected; no compiler or network client started (1 samples of a helper or bridge process, none with a socket)

Evidence:
- plugin `tests/startup.test.tsx::reports unsupported target without touching an archive` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/startup_refusal.test.tsx::rejects a non-interactive session without probing the host` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/startup_refusal.test.tsx::reports an unprovable operating system as unsupported` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/startup_refusal.test.tsx::rejects a non-arm64 host before reading a locator` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/startup_refusal.test.tsx::rejects a non-macOS-15 host before reading a locator` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/startup_refusal.test.tsx::reports an unproven Claude Code version when the locator is absent` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/startup_refusal.test.tsx::rejects a Claude Code version below the supported minimum` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/startup_refusal.test.tsx::reports a malformed Claude Code version as unproven` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- unit `helper_protocol.HelperProtocolTests.test_preflight_rejects_a_claude_version_below_the_minimum`: pass ([trace](logs/unit-tests.log))
- unit `artifact_static.StaticArtifactTests.test_host_version_parser_accepts_only_release_output`: pass ([trace](logs/unit-tests.log))
- pty `PH-COMPAT-002` on 2.1.290: pass ([trace](pty/2.1.290/PH-COMPAT-002.txt))

### PH-COMPAT-003 Helper 不可用

Result: **failed**

Steps:
1. 依次注入缺失、非普通文件、不可执行、摘要不符、错误 protocol、SQLite 能力不足与执行被拒的 helper（PTY 用插件副本注入缺失、符号链接、0644、0775、另一构建与另一 protocol 的 locator，并用记录调用的 helper 证明从未执行；SQLite 能力不足与执行被拒无法从外部造出，由 plugin test 与 helper 单测证明）
1. 启动并查看 `status`

Expected: 进入 helper unavailable；不静默更换 binary、SQLite 或使用内存时间线。

Actual: 1 failed, 20 pass; 2.1.290: failed: timed out waiting for the 档案不可用 dialog

Evidence:
- plugin `tests/startup_refusal.test.tsx::reports a helper missing from a trusted locator` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/startup_refusal.test.tsx::reports a helper removed after locator publication` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/startup_refusal.test.tsx::reports a manifest removed after locator publication` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/startup_refusal.test.tsx::rejects a locator bound to a different helper digest` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/startup_refusal.test.tsx::rejects an incompatible helper protocol before execution` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/startup_refusal.test.tsx::rejects a helper whose file digest changed` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/startup_refusal.test.tsx::rejects a non-regular helper before execution` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/startup_refusal.test.tsx::rejects a non-executable helper before execution` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/startup_refusal.test.tsx::rejects a group-writable helper before execution` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/startup_refusal.test.tsx::rejects a group-writable manifest before execution` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/startup_refusal.test.tsx::reports SQLite capability failure without helper diagnostics` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/startup_refusal.test.tsx::reports system execution refusal without leaking its error` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- unit `bridge_protocol.BridgeProtocolTests.test_publish_records_a_missing_helper_without_executing_it`: pass ([trace](logs/unit-tests.log))
- unit `bridge_protocol.BridgeProtocolTests.test_publish_records_a_changed_helper_digest`: pass ([trace](logs/unit-tests.log))
- unit `bridge_protocol.BridgeProtocolTests.test_publish_records_a_symlink_helper_as_non_regular`: pass ([trace](logs/unit-tests.log))
- unit `bridge_protocol.BridgeProtocolTests.test_publish_records_a_group_writable_helper_as_untrusted`: pass ([trace](logs/unit-tests.log))
- unit `bridge_protocol.BridgeProtocolTests.test_publish_records_a_write_acl_helper_as_untrusted`: pass ([trace](logs/unit-tests.log))
- unit `helper_protocol.HelperProtocolTests.test_probe_rejects_a_protocol_mismatch`: pass ([trace](logs/unit-tests.log))
- gate `protocol-mismatch-probe`: pass ([trace](logs/protocol-mismatch-probe.log))
- plugin `tests/startup_refusal.test.tsx::status runs no helper it cannot trust, even for a project that collects` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- pty `PH-COMPAT-003` on 2.1.290: failed ([trace](pty/2.1.290/PH-COMPAT-003.txt))

### PH-COMPAT-004 制品检查

Result: **pass**

Steps:
1. 重新构建制品并与仓库中的制品逐字节比较
1. 静态检查 Mach-O、依赖、摘要与 manifest
1. 在两个宿主版本上运行 `claude plugin validate`

Expected: 发布制品与 manifest 完全一致；任一不一致阻断发布。

Actual: 8 pass

Evidence:
- unit `artifact_static.StaticArtifactTests.test_native_artifacts_are_thin_arm64_pie_with_macos_15_floor`: pass ([trace](logs/unit-tests.log))
- unit `artifact_static.StaticArtifactTests.test_native_artifacts_link_only_allowed_system_libraries`: pass ([trace](logs/unit-tests.log))
- unit `artifact_static.StaticArtifactTests.test_native_artifacts_are_manifest_bound`: pass ([trace](logs/unit-tests.log))
- unit `artifact_static.StaticArtifactTests.test_manifest_records_build_provenance`: pass ([trace](logs/unit-tests.log))
- unit `artifact_static.StaticArtifactTests.test_manifest_schema_range_is_the_one_the_helper_writes`: pass ([trace](logs/unit-tests.log))
- gate `artifacts-reproducible`: pass ([trace](logs/build-artifacts.log))
- gate `typescript`: pass ([trace](logs/typescript.log))
- validate `plugin-validate` on 2.1.290: pass ([trace](logs/plugin-validate@2.1.290.log))

### PH-COMPAT-005 进程接入版本绑定

Result: **pass**

Steps:
1. 在运行中的 Run 里执行 `/reload-plugins`
1. 替换 helper 后再次提交
1. 恢复原 helper

Expected: helper 未变时 reload 可继续；路径、内容、摘要或 protocol 改变时当前进程接入进入 Archive unavailable，恢复原制品后可继续。

Actual: 5 pass; 2.1.290: a reload with the helper unchanged went on in the same Run; another helper held the next submission as this Run's failure with the archive unchanged and was never run; with the original back, a retry submitted it once in the same Run

Evidence:
- plugin `tests/run_identity.test.tsx::a helper that changes under a running Run stops it until the original returns` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/startup_refusal.test.tsx::refreshes helper status within the same session` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- unit `bridge_protocol.BridgeProtocolTests.test_publish_names_the_locator_for_its_host_process_generation`: pass ([trace](logs/unit-tests.log))
- unit `helper_protocol.HelperProtocolTests.test_preflight_rejects_a_stale_host_generation`: pass ([trace](logs/unit-tests.log))
- pty `PH-COMPAT-005` on 2.1.290: pass ([trace](pty/2.1.290/PH-COMPAT-005.txt))

### PH-CAPTURE-001 基本恰好一次

Result: **pass**

Steps:
1. 同意采集后提交一个带标记的 prompt
1. 展开 band
1. 用 semantic verifier 读取档案

Expected: 只产生一个 Prompt Entry，文本为最终文本，sequence 单调；UI、档案与 transcript 的人类 prompt 顺序一致。

Actual: 6 pass; 2.1.290: 1 entry at sequence 2, no pending, shown once in the band, present in the transcript

Evidence:
- plugin `tests/consent_capture.test.tsx::enabled consent stages through stdin and confirms the final prompt atomically` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/composer_capture.test.tsx::no origin but the composer creates a Prompt Entry` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/reconcile_pending.test.tsx::a rewritten final text is what a same-Run reconciliation archives` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- unit `helper_protocol.HelperProtocolTests.test_capture_stages_then_atomically_confirms_a_prompt_entry`: pass ([trace](logs/unit-tests.log))
- unit `helper_protocol.HelperProtocolTests.test_capture_begin_is_idempotent_and_never_reopens_a_confirmed_event`: pass ([trace](logs/unit-tests.log))
- pty `PH-CAPTURE-001` on 2.1.290: pass ([trace](pty/2.1.290/PH-CAPTURE-001.txt))

### PH-CAPTURE-002 重复文本

Result: **pass**

Steps:
1. 连续提交三个完全相同的 prompt
1. 展开 band 并读取档案

Expected: 三个独立 Prompt Entry、独立 sequence，不按文本去重。

Actual: 4 pass; 2.1.290: 3 distinct entries at sequences [2, 3, 4]

Evidence:
- plugin `tests/composer_capture.test.tsx::three identical prompts stay three distinct Prompt Entries` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- unit `helper_protocol.HelperProtocolTests.test_three_identical_prompts_form_three_distinct_prompt_entries`: pass ([trace](logs/unit-tests.log))
- unit `helper_protocol.HelperProtocolTests.test_branch_match_tells_repeated_prompts_apart_by_their_whole_prefix`: pass ([trace](logs/unit-tests.log))
- pty `PH-CAPTURE-002` on 2.1.290: pass ([trace](pty/2.1.290/PH-CAPTURE-002.txt))

### PH-CAPTURE-003 多行与宽字符

Result: **pass**

Steps:
1. 提交含空行、CJK、emoji 与组合字符的多行 prompt
1. 展开 band 并读取档案

Expected: 档案逐字保存原文；UI 把换行显示为 `↵`，按单元格宽度截断加省略号，不换第二行。

Actual: 6 pass; 2.1.290: multi-line CJK/emoji/combining text archived verbatim; shown on one row with ↵

Evidence:
- plugin `tests/composer_capture.test.tsx::wide, blank-line and combining text is archived verbatim and shown on one line` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/terminal_fallbacks.test.tsx::a row is measured in the cells the terminal draws it in` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/terminal_fallbacks.test.tsx::a row is cut to its cells with an ellipsis, never inside a character` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- unit `helper_protocol.HelperProtocolTests.test_capture_preserves_blank_lines_cjk_emoji_and_combining_marks`: pass ([trace](logs/unit-tests.log))
- unit `helper_protocol.HelperProtocolTests.test_capture_rejects_prompt_bytes_that_are_not_valid_utf8`: pass ([trace](logs/unit-tests.log))
- pty `PH-CAPTURE-003` on 2.1.290: pass ([trace](pty/2.1.290/PH-CAPTURE-003.txt))

### PH-CAPTURE-004 附件边界

Result: **pass**

Steps:
1. 提交带图片附件的 prompt
1. 读取档案

Expected: 只保存附件数量与宽泛类型，不保存内容、名称、路径或哈希；纯附件提交仍产生 Prompt Entry。

Actual: 4 pass; 2.1.290: with text: 1 attachment(s) of kinds image; alone: an entry with 1 attachment(s) and only the host placeholder as text; no name or path archived

Evidence:
- plugin `tests/composer_capture.test.tsx::attachments archive only their count and broad kinds` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/composer_capture.test.tsx::an attachment-only submission forms a text-less Prompt Entry` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- unit `helper_protocol.HelperProtocolTests.test_an_attachment_only_submission_forms_a_text_less_prompt_entry`: pass ([trace](logs/unit-tests.log))
- pty `PH-CAPTURE-004` on 2.1.290: pass ([trace](pty/2.1.290/PH-CAPTURE-004.txt))

### PH-CAPTURE-005 Slash 与控制命令

Result: **pass**

Steps:
1. 依次运行 `/cost`、`/compact`、`/clear`、`/reload-plugins`、`/rewind`（Esc 关闭）与 `/prompt-history status`
1. 读取档案

Expected: 这些命令都不产生 Prompt Entry。

Actual: 4 pass; 2.1.290: /cost, /prompt-history status, /reload-plugins, /compact, /clear, /rewind created no Prompt Entry

Evidence:
- plugin `tests/composer_capture.test.tsx::a slash command run archives nothing while slash text still does` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/clear_segment.test.tsx::a control command creates no Prompt Entry of its own` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/clear_segment.test.tsx::compaction, reload and the other sources create no Clear Boundary` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- pty `PH-CAPTURE-005` on 2.1.290: pass ([trace](pty/2.1.290/PH-CAPTURE-005.txt))

### PH-CAPTURE-006 非人类流量

Result: **pass**

Steps:
1. 提交一个 prompt 后执行 `/compact`、重绘 band 与 plugin reload
1. 读取档案

Expected: task notification、内部 user row、render preview 与重放均不创建 Prompt Entry。

Actual: 5 pass; 2.1.290: compaction rows, band redraws and a reload's replay created no Prompt Entry

Evidence:
- plugin `tests/composer_capture.test.tsx::no origin but the composer creates a Prompt Entry` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/composer_capture.test.tsx::a render replay never archives an entry again` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/jump_target.test.tsx::previews, notifications and rows drawn twice never reach the alignment` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/clear_segment.test.tsx::drawing the band again archives nothing` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- pty `PH-CAPTURE-006` on 2.1.290: pass ([trace](pty/2.1.290/PH-CAPTURE-006.txt))

### PH-CAPTURE-007 Hook 链 drop

Result: **pass**

Steps:
1. 加载一个在下游 drop 带标记 prompt 的测试插件
1. 提交该 prompt
1. 读取档案与 pending

Expected: 不创建 Prompt Entry；Pending Capture 被确认丢弃。

Actual: 3 pass; 2.1.290: prompt-history stages above the fixture; a prompt dropped beneath left no entry and no pending

Evidence:
- plugin `tests/composer_capture.test.tsx::a drop beneath leaves no Prompt Entry and discards the Pending Capture` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- unit `helper_protocol.HelperProtocolTests.test_an_aborted_capture_leaves_no_entry_and_repeats_idempotently`: pass ([trace](logs/unit-tests.log))
- pty `PH-CAPTURE-007` on 2.1.290: pass ([trace](pty/2.1.290/PH-CAPTURE-007.txt))

### PH-CAPTURE-008 Pending Capture 对账

Result: **pass**

Steps:
1. 让下游测试插件暂停带标记的提交，期间占住档案写锁，使 prompt 进入对话后的确认失败
1. 查看 `status`，释放写锁后提交下一条 prompt
1. 对账确认上一条后，重新提交被退回为草稿的这一条

Expected: 保留 pending 并阻止后续提交；宿主存下了它自己的 composer 行时，下一次提交先自动补确认；无法证明时由使用者在「已进入 / 未进入 / 新根分支」中选择，不可能进入时不提供「已进入」。

Actual: 10 pass; 2.1.290: a refused confirmation kept the pending and status reported it; the next submission confirmed it from its own stored row and handed its own text back as a draft, which then went through

Evidence:
- plugin `tests/reconcile_pending.test.tsx::a failed confirmation keeps the pending and blocks the next submission` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/reconcile_pending.test.tsx::a confirmation that failed after the prompt's row was stored is confirmed next time` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/reconcile_pending.test.tsx::a transcript without the prompt does not settle a pending its rows do not prove` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/reconcile_pending.test.tsx::a pending discovered after a restart offers all three choices, and 已进入 archives it` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/reconcile_pending.test.tsx::未进入 discards the pending and leaves the branch alone` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/reconcile_pending.test.tsx::新根分支 discards the pending and starts a new root branch` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/reconcile_pending.test.tsx::a restart discovers the pending from the archive and confirms it from staged text` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- unit `helper_protocol.HelperProtocolTests.test_confirm_from_pending_archives_the_staged_text`: pass ([trace](logs/unit-tests.log))
- unit `helper_protocol.HelperProtocolTests.test_capture_list_reports_unresolved_pendings_without_prompt_text`: pass ([trace](logs/unit-tests.log))
- pty `PH-CAPTURE-008` on 2.1.290: pass ([trace](pty/2.1.290/PH-CAPTURE-008.txt))

### PH-LIFE-001 /clear

Result: **pass**

Steps:
1. 提交 prompt 后执行 `/clear`，再提交
1. `/exit` 后普通重启，第一件事就执行 `/clear`，再提交；`/exit` 后 `--resume` 同样再做一次
1. 读取档案

Expected: 恰好一个 Clear Boundary；Run 不变，前后 prompt 分属不同 Segment；重复事件与两事件间崩溃不重复也不丢失边界。新进程第一件事就执行 `/clear` 时同样恰好记下一个 Clear Boundary，不记成 Integrity gap；整个场景三次 `/clear`，共 3 个 Clear Boundary。

Actual: 12 pass; 2.1.290: 1 Clear Boundary between the prompts; same Run, two segments, a new root branch after it; shown in the band; a /clear first thing after a restart and after --resume is a Clear Boundary too, never an Integrity gap

Evidence:
- plugin `tests/clear_segment.test.tsx::a clear end writes one boundary against the segment it closes` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/clear_segment.test.tsx::a repeated clear end asks for no second boundary` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/clear_segment.test.tsx::a clear start associates the new session without a second boundary` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/clear_segment.test.tsx::a clear start with no end observed invents no boundary` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/clear_segment.test.tsx::a queued Clear Boundary is written before the next Prompt Entry` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/clear_segment.test.tsx::the segment after a clear starts a new root branch` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/clear_segment.test.tsx::a clear before this process has read its locator still writes the boundary` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- unit `bridge_protocol.BridgeProtocolTests.test_clear_rotates_locator_without_changing_run_identity`: pass ([trace](logs/unit-tests.log))
- unit `helper_protocol.HelperProtocolTests.test_a_clear_boundary_separates_two_conversation_segments`: pass ([trace](logs/unit-tests.log))
- unit `helper_protocol.HelperProtocolTests.test_a_repeated_clear_boundary_stays_one_boundary`: pass ([trace](logs/unit-tests.log))
- unit `artifact_static.StaticArtifactTests.test_every_classic_session_end_reaches_the_lifecycle_state_machine`: pass ([trace](logs/unit-tests.log))
- pty `PH-LIFE-001` on 2.1.290: pass ([trace](pty/2.1.290/PH-LIFE-001.txt))

### PH-LIFE-002 Compaction

Result: **pass**

Steps:
1. 提交 prompt 后执行 `/compact`，再提交
1. 读取档案

Expected: 不创建 Clear Boundary、Prompt Entry 或新 Run；活动分支保持连续。

Actual: 4 pass; 2.1.290: no Clear Boundary, no new Run, no extra entry; the prompt after /compact continues the branch; both entries jumpable

Evidence:
- plugin `tests/clear_segment.test.tsx::compaction, reload and the other sources create no Clear Boundary` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/clear_segment.test.tsx::a compact start leaves an in-flight clear transition alone` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/rewind_branch.test.tsx::a compaction seen in this process keeps the branch it was on` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- pty `PH-LIFE-002` on 2.1.290: pass ([trace](pty/2.1.290/PH-LIFE-002.txt))

### PH-LIFE-003 Plugin reload

Result: **pass**

Steps:
1. 展开 band 并选中一项
1. 执行 `/reload-plugins`
1. 读取档案

Expected: 沿用 Run；重放不创建 Prompt Entry，已绑定项不重复，展开状态恢复；选中位置不保留，reload 后与 Esc 后一样从最新条目开始。

Actual: 5 pass; 2.1.290: same Run, still expanded, each entry once and jumpable, no new entry; entering the band starts on the latest entry

Evidence:
- plugin `tests/run_identity.test.tsx::a reload inside the same process generation opens nothing` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/run_identity.test.tsx::a reload of the same Run keeps its start, its entries and its expanded band` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/consent_capture.test.tsx::stored current-policy consent survives reload without another question` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/composer_capture.test.tsx::a render replay never archives an entry again` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- pty `PH-LIFE-003` on 2.1.290: pass ([trace](pty/2.1.290/PH-LIFE-003.txt))

### PH-LIFE-004 正常退出与普通重启

Result: **pass**

Steps:
1. 提交 prompt 后正常退出
1. 在同一项目普通启动并展开 band

Expected: 记录 Run 离开；新进程获得新 Run，沿用 Project Timeline 与 generation；旧条目可浏览但无 Jump Target。

Actual: 6 pass; 2.1.290: exit recorded the Run leaving; the restart got a new Run on the same generation; the old Run shows start, × entry, leaving

Evidence:
- plugin `tests/run_identity.test.tsx::an exit detaches this process once, against the session it exits from` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/run_identity.test.tsx::a restart continues the Project Timeline under a new Run` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/jump_target.test.tsx::a new session that draws none of the archived rows marks every entry ×` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- unit `bridge_protocol.BridgeProtocolTests.test_normal_end_removes_only_the_matching_session_locator`: pass ([trace](logs/unit-tests.log))
- unit `helper_protocol.HelperProtocolTests.test_a_run_no_longer_ends_it_only_detaches`: pass ([trace](logs/unit-tests.log))
- pty `PH-LIFE-004` on 2.1.290: pass ([trace](pty/2.1.290/PH-LIFE-004.txt))

### PH-BRANCH-001 Resume

Result: **pass**

Steps:
1. 提交若干 prompt 后退出
1. 分别以 `--resume`、`--continue` 与会话内 `/resume` 续接
1. 双终端并发 resume 同一会话

Expected: 续接原 Run 并记录续接；共享历史只重绑 Jump Target 不重复归档；会话内 `/resume` 回到本进程先前画过的会话时，其历史与之后的新条目都能跳转；离开活动路径的条目折叠；并发时后到者新建 Run。

Actual: 12 pass; 2.1.290: --continue and a concurrent --resume bind the shared history once and archive none of it; --continue, --resume and an in-process /resume keep the Run and go on from the session's last entry; an in-process /resume back into a session this process drew binds its history and the next prompt again; the prompt after /clear folds where it left; a resume while the Run is held branches off in a new Run

Evidence:
- plugin `tests/resume_fork_branch.test.tsx::a resume continues the stored lineage, matched inside its own session` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/resume_fork_branch.test.tsx::a resume replaying shared history archives nothing for it` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/resume_fork_branch.test.tsx::entries a resume left behind fold into one row that expands` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/run_identity.test.tsx::a resume in a new process continues the Run it left` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/continued_session.test.tsx::a continued session goes on along the branch of the session it came from` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/jump_target.test.tsx::rows replayed by an in-process resume back into a drawn session are tied again` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/jump_target.test.tsx::rows drawn on the way out of a clear are never tied, even once the next session starts` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- unit `bridge_protocol.BridgeProtocolTests.test_resume_after_the_process_exited_continues_its_run`: pass ([trace](logs/unit-tests.log))
- unit `bridge_protocol.BridgeProtocolTests.test_resume_while_a_live_process_holds_the_run_begins_a_new_run`: pass ([trace](logs/unit-tests.log))
- unit `bridge_protocol.BridgeProtocolTests.test_in_process_resume_to_a_session_of_the_same_run_keeps_it`: pass ([trace](logs/unit-tests.log))
- unit `helper_protocol.HelperProtocolTests.test_branch_match_finds_the_entry_a_resumed_transcript_ends_on`: pass ([trace](logs/unit-tests.log))
- pty `PH-BRANCH-001` on 2.1.290: pass ([trace](pty/2.1.290/PH-BRANCH-001.txt))

### PH-BRANCH-002 Fork

Result: **pass**

Steps:
1. 分别用后台 `/fork` 与 `--fork-session` 分叉
1. 在分叉中提交
1. 来源 `/compact` 后再提交一条，再分别用后台 `/fork` 与 `--fork-session` 分叉并提交

Expected: 创建新 Run 与新 Conversation Branch；共享前缀不重复；fork 参数作为 composer 提交时产生新 Prompt Entry。compact 过的 session 分叉后，第一条同样挂在来源的最后一条 Prompt Entry 上。

Actual: 10 pass; 2.1.290: a background /fork archived its argument once in a new Run and branch after the shared history; --fork-session bound the shared history, marked the other fork ×, and started a Run of its own that says which Run it branched off; after /compact both forks still went on from the source's last entry, and --fork-session bound it before submitting

Evidence:
- plugin `tests/resume_fork_branch.test.tsx::a fork starts its branch from the entry its shared history ends on` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/resume_fork_branch.test.tsx::a forked Run names the Run its first entry continues` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/resume_fork_branch.test.tsx::a fork whose shared history matches several lineages archives from a marked root` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/resume_fork_branch.test.tsx::a fork of a compacted session places its shared history among truncated lineages` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/resume_fork_branch.test.tsx::a fork whose transcript only quotes the compaction summary later is matched whole` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/jump_target.test.tsx::a fork of a compacted session ties its shared history before it submits anything` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- unit `bridge_protocol.BridgeProtocolTests.test_only_a_fork_the_source_names_is_a_continuation`: pass ([trace](logs/unit-tests.log))
- unit `bridge_protocol.BridgeProtocolTests.test_a_child_that_inherits_the_run_environment_gets_its_own_run`: pass ([trace](logs/unit-tests.log))
- unit `helper_protocol.HelperProtocolTests.test_branch_match_follows_a_fork_across_runs`: pass ([trace](logs/unit-tests.log))
- pty `PH-BRANCH-002` on 2.1.290: pass ([trace](pty/2.1.290/PH-BRANCH-002.txt))

### PH-BRANCH-003 Rewind 与 Esc Esc

Result: **pass**

Steps:
1. 提交若干 prompt 后用 `/rewind` 与 Esc Esc 回到旧位置
1. 提交新 prompt

Expected: 首次提交创建新分支，原分支永久保留；不依赖 `command.run(rewind)`。

Actual: 5 pass; 2.1.290: /rewind to before B: the next prompt follows A on a new branch and B, C fold where it left; Esc Esc to the start: the next prompt starts a root branch below every old entry, all kept

Evidence:
- plugin `tests/rewind_branch.test.tsx::a transcript rewound to an earlier prompt branches from the entry before it` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/rewind_branch.test.tsx::a transcript rewound to its root starts a root branch without asking` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/rewind_branch.test.tsx::the timeline shows where a rewind started a root branch, with the old one still in view` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/rewind_branch.test.tsx::a rewind menu closed without restoring leaves the next parent where it was` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- pty `PH-BRANCH-003` on 2.1.290: pass ([trace](pty/2.1.290/PH-BRANCH-003.txt))

### PH-BRANCH-004 父节点歧义

Result: **pass**

Steps:
1. 跨进程 resume 一个 compact 过的会话，使 transcript 无法唯一确定父节点
1. 提交 prompt
1. 在候选 Pane 中选择

Expected: 首次提交被 drop，草稿只在内存；候选 Pane 已聚焦；选择后关闭 Pane、用 `$.prompt.fill()` 恢复草稿且不自动重提。

Actual: 6 pass; 2.1.290: a compacted resume dropped the first submission into a focused parent Pane with the box empty; Esc put the draft back and a resubmission asked again; a click on B closed the Pane and put the draft back unsent; the next submission followed B

Evidence:
- plugin `tests/confirm_parent.test.tsx::an ambiguous submission is dropped and the person chooses in a focused Pane` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/confirm_parent.test.tsx::a submission made before choosing is dropped too, and its text is the draft that comes back` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/confirm_parent.test.tsx::a draft the prompt box will not take back is said to be lost, never claimed restored` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/resume_fork_branch.test.tsx::the person's answer keeps, moves or re-roots the branch` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- unit `helper_protocol.HelperProtocolTests.test_branch_match_leaves_identical_lineages_to_the_caller`: pass ([trace](logs/unit-tests.log))
- pty `PH-BRANCH-004` on 2.1.290: pass ([trace](pty/2.1.290/PH-BRANCH-004.txt))

### PH-JUMP-001 有效目标

Result: **pass**

Steps:
1. 展开 band
1. 分别用鼠标点击与 Enter 激活一个当前 transcript 中的条目

Expected: 跳转成功后折叠并把焦点还给 composer。

Actual: 3 pass; 2.1.290: Enter and a click each brought an off-screen entry into view, collapsed the band and gave typing back to the prompt box

Evidence:
- plugin `tests/jump_target.test.tsx::replayed rows the helper places become jump targets; the rest are marked ×` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/jump_target.test.tsx::a jump the engine made collapses, one it refused goes stale, a failure changes nothing` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- pty `PH-JUMP-001` on 2.1.290: pass ([trace](pty/2.1.290/PH-JUMP-001.txt))

### PH-JUMP-002 失效目标

Result: **pass**

Steps:
1. 普通重启后展开 band
1. 激活标为 `×` 的条目

Expected: 条目保留并显示 `×`；激活无副作用、不折叠、不猜测目标。

Actual: 4 pass; 2.1.290: after a restart the old entry is × beside a jumpable twin of the same text; Enter and a click on it left the band, the transcript and the archive as they were

Evidence:
- plugin `tests/jump_target.test.tsx::activating an entry marked × does nothing, and the band stays open` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/jump_target.test.tsx::a new session that draws none of the archived rows marks every entry ×` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/jump_target.test.tsx::a jump the engine could not carry out keeps the entry and the band as they were` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- pty `PH-JUMP-002` on 2.1.290: pass ([trace](pty/2.1.290/PH-JUMP-002.txt))

### PH-UI-001 折叠和展开

Result: **pass**

Steps:
1. 启动后查看 band
1. 点击标题与执行 `/prompt-history` 切换
1. 按 Esc

Expected: 默认一行 `prompt-history`；展开提示 `ctrl+x tab` 或鼠标；Esc 把焦点还给 composer。

Actual: 6 pass; 2.1.290: starts as one collapsed title row; a title click opens it with the ctrl+x tab hint and folds it again; /prompt-history opens it without taking the keyboard; ctrl+x tab lands on the entry; Esc gives typing back and the band stays open; /prompt-history folds it again

Evidence:
- plugin `tests/startup.test.tsx::starts collapsed with only the prompt-history title` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/consent_capture.test.tsx::bare prompt-history expands and renders the confirmed first entry` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/terminal_fallbacks.test.tsx::the title row says how to take the keyboard, whatever holds it` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/run_identity.test.tsx::the band starts collapsed in a new Run and its state is kept per Run` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/run_identity.test.tsx::bare prompt-history folds an expanded band and opens a folded one, kept per Run` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- pty `PH-UI-001` on 2.1.290: pass ([trace](pty/2.1.290/PH-UI-001.txt))

### PH-UI-002 顺序与边界

Result: **pass**

Steps:
1. 构造含 Prompt Entry、Run、Clear、Collection、分支与 Integrity Gap 边界的时间线
1. 展开并加载更早数据

Expected: 按旧到新显示，每项稳定 keyed；加载更早数据后当前选择不跳动。

Actual: 6 pass; 2.1.290: walked 293 stops from the latest event to the first; entries old to new, every boundary row matching the archive between its entries, each kind drawn (Run start/leave/attach, clear, collection stop/resume, Integrity gap/recovery) and branches marked; gap rows in the warning colour, other rows dimmed; the ring and view held still while batches loaded

Evidence:
- plugin `tests/clear_segment.test.tsx::the timeline keeps both sides of a clear in their original order` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/collection_mode.test.tsx::the disabled interval is drawn as an explicit break, not as history` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/integrity_gap.test.tsx::a gap and its recovery are drawn in a warning colour, even inside another Run’s fold` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/long_timeline.test.tsx::scrolling to the top of the window loads the batch before it without moving the view` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- unit `helper_protocol.HelperProtocolTests.test_timeline_read_returns_entries_and_boundaries_in_sequence_order`: pass ([trace](logs/unit-tests.log))
- pty `PH-UI-002` on 2.1.290: pass ([trace](pty/2.1.290/PH-UI-002.txt))

### PH-UI-003 新条目

Result: **pass**

Steps:
1. 在底部时提交新 prompt
1. 离开底部后再提交
1. 回到底部

Expected: 底部时跟随；查看旧历史时保持位置并累加新条目提示，回到底部后清零。

Actual: 4 pass; 2.1.290: at the bottom a new entry was followed uncounted; away from it the view held while the title and the row under it counted 1 then 2; that row took the view back to both entries and cleared the count

Evidence:
- plugin `tests/long_timeline.test.tsx::at the bottom a new entry is followed and nothing is counted` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/long_timeline.test.tsx::away from the bottom a new entry keeps the view and is counted until the band returns` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/long_timeline.test.tsx::scrolling back to the bottom clears the count` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- pty `PH-UI-003` on 2.1.290: pass ([trace](pty/2.1.290/PH-UI-003.txt))

### PH-UI-004 连续浏览

Result: **failed**

Steps:
1. 用方向键、Enter、鼠标 hover 与点击遍历时间线到首尾

Expected: 无页码；可遍历并激活完整时间线；最早可见项获得焦点时预载上一批并保留同一 keyed Button。

Actual: 1 failed, 8 pass; 2.1.290: failed: timed out waiting for a click to fold it

Evidence:
- plugin `tests/long_timeline.test.tsx::an arrow off the first row shown moves the view up one row` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/long_timeline.test.tsx::each arrow walks on from the row the view followed to, even while the engine refuses the ring there` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/long_timeline.test.tsx::arrows pressed faster than the band draws each walk a row` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/long_timeline.test.tsx::an arrow from the first entry onto the title shows the rows above that entry` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/long_timeline.test.tsx::a ring the view followed is sent again from a later drawing, once` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/long_timeline.test.tsx::the ring reaching the window's first row fetches the batch before it` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/long_timeline.test.tsx::scrolling alone walks to the first event and back to the latest, never holding more than the window` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- unit `helper_protocol.HelperProtocolTests.test_timeline_read_walks_the_whole_timeline_in_fixed_batches_both_ways`: pass ([trace](logs/unit-tests.log))
- pty `PH-UI-004` on 2.1.290: failed ([trace](pty/2.1.290/PH-UI-004.txt))

### PH-UI-005 滚动拒绝降级

Result: **pass**

Steps:
1. 在不发送 `ui.scroll` 的终端里用方向键与点击到达首尾

Expected: 方向键与点击仍可到达首尾；触控板/滚轮不是支持路径。

Actual: 5 pass; 2.1.290: from the bottom, where the count row counted the rows above alone, 267 trackpad ticks reached the first event; folding and opening came back to the latest; the arrows left the bottom

Evidence:
- plugin `tests/long_timeline.test.tsx::the engine's scroll keys move the view the same way` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/long_timeline.test.tsx::an arrow down from the last entry shows the rows still below it and follows again` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/long_timeline.test.tsx::an arrow from the first entry onto the title shows the rows above that entry` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/jump_target.test.tsx::a row the engine refused to scroll to is never a target again` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- pty `PH-UI-005` on 2.1.290: pass ([trace](pty/2.1.290/PH-UI-005.txt))

### PH-UI-006 长历史

Result: **pass**

Steps:
1. 构造 100,000 个 Timeline Events
1. 展开、加载下一批与显示新条目各预热一次后重复十次

Expected: 查询与渲染不超过固定窗口，能到达首尾；三项 p95 各不超过 1 秒并记录参考硬件。

Actual: 6 pass; 2.1.290: 100,000 events; one warm-up then ten runs each, key to frame: open p95 211 ms; a press across an earlier batch's load p95 259 ms; show a new entry p95 329 ms

Evidence:
- plugin `tests/long_timeline.test.tsx::100,000 events are browsed through a window that never holds or draws more than two batches` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/run_identity.test.tsx::the read is bounded to the latest fixed batch` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- unit `helper_protocol.HelperProtocolTests.test_timeline_read_walks_the_whole_timeline_in_fixed_batches_both_ways`: pass ([trace](logs/unit-tests.log))
- unit `helper_protocol.HelperProtocolTests.test_capture_list_enforces_a_fixed_maximum_batch`: pass ([trace](logs/unit-tests.log))
- gate `benchmark-100k`: pass ([trace](logs/benchmark-100k.log))
- pty `PH-UI-006` on 2.1.290: pass ([trace](pty/2.1.290/PH-UI-006.txt))

### PH-UI-007 窄终端

Result: **pass**

Steps:
1. 在 28 列与 6 行边界两侧调整终端尺寸
1. 恢复尺寸
1. 在 30–40 列下查看 CJK、emoji 与多行条目

Expected: 低于门槛只显示折叠控制与空间不足提示；恢复后保留展开状态、选择、位置与计数；条目不换第二行。

Actual: 5 pass; 2.1.290: at 27 columns and at 21 rows the open band drew its title alone, saying space is short; at 28 and 22 its rows came back; restored, it showed the same rows and count with the ring on the same entry; a wide, combining, multi-line entry kept to one row at 30, 34 and 40 columns; while cramped the title folded and opened the band

Evidence:
- plugin `tests/terminal_fallbacks.test.tsx::too narrow or too short, the open band shows its title and that space is short` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/terminal_fallbacks.test.tsx::the title still folds and opens the band while space is short` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/terminal_fallbacks.test.tsx::room again, the band shows the rows and new-entry count it had before` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/composer_capture.test.tsx::wide, blank-line and combining text is archived verbatim and shown on one line` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- pty `PH-UI-007` on 2.1.290: pass ([trace](pty/2.1.290/PH-UI-007.txt))

### PH-UI-008 AskUserQuestion 让出

Result: **failed**

Steps:
1. 展开 band 后让模型调用 AskUserQuestion
1. 回答后查看 band

Expected: 对话期间让出 AbovePrompt，结束后恢复展开与选择状态。

Actual: 1 failed, 2 pass; 2.1.290: failed: timed out waiting for the model's AskUserQuestion dialog

Evidence:
- plugin `tests/terminal_fallbacks.test.tsx::an AskUserQuestion dialog takes the band's place until it closes` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/terminal_fallbacks.test.tsx::a dialog that fails still gives the band back` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- pty `PH-UI-008` on 2.1.290: failed ([trace](pty/2.1.290/PH-UI-008.txt))

### PH-STORE-001 重启延续

Result: **pass**

Steps:
1. 提交 prompt 后退出并重新启动
1. 再次提交并读取档案

Expected: sequence、历史事件、generation 与 consent 延续；普通启动得到新 Run，resume 续接原 Run。

Actual: 5 pass; 2.1.290: a restart kept the earlier entry, the generation and consent under a new Run; a resume attached to the first Run; sequence 1..8 unbroken

Evidence:
- plugin `tests/run_identity.test.tsx::a restart continues the Project Timeline under a new Run` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/consent_capture.test.tsx::stored current-policy consent survives reload without another question` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/reconcile_pending.test.tsx::a restart discovers the pending from the archive and confirms it from staged text` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- unit `helper_protocol.HelperProtocolTests.test_run_boundaries_share_the_sequence_and_stay_idempotent`: pass ([trace](logs/unit-tests.log))
- pty `PH-STORE-001` on 2.1.290: pass ([trace](pty/2.1.290/PH-STORE-001.txt))

### PH-STORE-002 双 Run 并发

Result: **pass**

Steps:
1. 两个终端对同一项目交错提交（event ID 幂等要从外部重放同一事件，由 helper 单测证明）
1. 禁用其中一个 Run

Expected: sequence 单调唯一、event ID 幂等、各自 Active Branch；禁用一个 Run 不影响另一个。

Actual: 6 pass; 2.1.290: two Runs submitting in turn: sequence unique and in submission order, event IDs unique, each prompt under its own Run's previous one; one Run disabled archived nothing more while the other went on along its branch

Evidence:
- plugin `tests/project_isolation.test.tsx::disabling this Run leaves another Run its branch, its owed writes and its archive` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/project_isolation.test.tsx::another Run writing alongside this one folds into one place from its first event` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/collection_mode.test.tsx::disabling this Run leaves another Run mode untouched` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- unit `helper_protocol.HelperProtocolTests.test_twenty_four_concurrent_runs_all_commit_in_one_gapless_sequence`: pass ([trace](logs/unit-tests.log))
- unit `helper_protocol.HelperProtocolTests.test_reads_of_a_current_archive_answer_while_another_run_holds_the_write_lock`: pass ([trace](logs/unit-tests.log))
- pty `PH-STORE-002` on 2.1.290: pass ([trace](pty/2.1.290/PH-STORE-002.txt))

### PH-STORE-003 Busy

Result: **pass**

Steps:
1. 占住档案写锁后提交
1. 释放后重试

Expected: 有界退避不超过 10 秒；超时进入 Archive unavailable，不后台无限重试。

Actual: 5 pass; 2.1.290: a held write lock ended in archive-busy after 8.1 s, a helper seen waiting meanwhile; for 15 s with the dialog up no helper ran; released, a retry archived and submitted the prompt once

Evidence:
- plugin `tests/archive_unavailable.test.tsx::a busy archive met while rebuilding the branch offers the same choice` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/archive_unavailable.test.tsx::a retry after the archive recovers submits the same prompt once` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- unit `helper_protocol.HelperProtocolTests.test_a_held_write_lock_ends_in_archive_busy_within_the_wait_budget`: pass ([trace](logs/unit-tests.log))
- unit `helper_protocol.HelperProtocolTests.test_a_lock_released_during_the_wait_lets_the_write_through`: pass ([trace](logs/unit-tests.log))
- pty `PH-STORE-003` on 2.1.290: pass ([trace](pty/2.1.290/PH-STORE-003.txt))

### PH-STORE-004 空间不足

Result: **pass**

Steps:
1. 在小磁盘镜像上提交直到低于 1 GiB 与写满

Expected: 每个 Run 只警告一次；`ENOSPC` 完整回滚，不产生半事件、不丢 pending、不删减历史。

Actual: 6 pass

Evidence:
- plugin `tests/archive_unavailable.test.tsx::low disk space is shown once per Run and reported by status` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/archive_unavailable.test.tsx::a Run already warned of low space is not warned again after a restart` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/archive_unavailable.test.tsx::low disk space still warns once when the store cannot remember it` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- unit `helper_protocol.HelperProtocolTests.test_a_full_disk_stages_nothing_and_keeps_an_earlier_pending_whole`: pass ([trace](logs/unit-tests.log))
- unit `helper_protocol.HelperProtocolTests.test_a_full_disk_before_the_first_capture_is_named_archive_full`: pass ([trace](logs/unit-tests.log))
- unit `helper_protocol.HelperProtocolTests.test_capture_begin_reports_low_space_on_a_small_disk`: pass ([trace](logs/unit-tests.log))

### PH-STORE-005 权限与路径

Result: **pass**

Steps:
1. 注入错误 owner、symlink、非普通文件、宽权限、异常 ACL、路径逃逸与陈旧 locator

Expected: 只在对象可信时自动收紧，其余一律拒绝且不执行可疑 helper。

Actual: 10 pass

Evidence:
- plugin `tests/startup_refusal.test.tsx::rejects a widened locator before trusting its artifact status` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/startup_refusal.test.tsx::rejects an ACL on the locator before reading it` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/startup_refusal.test.tsx::rejects an ACL on the locator directory before reading it` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- unit `helper_protocol.HelperProtocolTests.test_preflight_rejects_a_symlink_locator`: pass ([trace](logs/unit-tests.log))
- unit `helper_protocol.HelperProtocolTests.test_preflight_rejects_a_widened_locator`: pass ([trace](logs/unit-tests.log))
- unit `helper_protocol.HelperProtocolTests.test_preflight_rejects_a_locator_with_an_extended_acl`: pass ([trace](logs/unit-tests.log))
- unit `helper_protocol.HelperProtocolTests.test_capture_list_refuses_an_archive_root_it_cannot_vouch_for`: pass ([trace](logs/unit-tests.log))
- unit `helper_protocol.HelperProtocolTests.test_preflight_accepts_a_non_write_artifact_acl`: pass ([trace](logs/unit-tests.log))
- unit `bridge_protocol.BridgeProtocolTests.test_publish_removes_only_proven_stale_private_locators`: pass ([trace](logs/unit-tests.log))
- unit `bridge_protocol.BridgeProtocolTests.test_publish_rejects_a_group_writable_plugin_directory`: pass ([trace](logs/unit-tests.log))

### PH-STORE-006 损坏

Result: **pass**

Steps:
1. 写坏档案后提交
1. 分别选择重新检查、隔离并开始新档案与清除全部档案

Expected: 停止整个 generation 写入，原文件不变；重试检查、隔离后新 generation 与强确认 `clear-all` 均按预期。

Actual: 15 pass; 2.1.290: damage offered its four choices for every Run of the project and held another Run before it wrote anything; a recheck with the damage standing asked again and changed nothing, and once the page was put back it passed and let the prompt the damage held at its pre-write through once and archived it once; a quarantine kept the damaged archive byte for byte and started a new generation with the prompt; a mistyped phrase removed nothing, and the phrase cleared everything and let the prompt through once

Evidence:
- plugin `tests/quarantine_archive.test.tsx::damage offers a recheck, a quarantine, a clear, or disabling the Run` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/quarantine_archive.test.tsx::a recheck that passes lifts the report and submits the prompt once` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/quarantine_archive.test.tsx::a quarantine moves the damaged generation aside and the prompt starts the next one` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/clear_all.test.tsx::damage offers a clear, which lets the held submission through once confirmed` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- unit `helper_protocol.HelperProtocolTests.test_damage_an_ordinary_command_meets_is_named_archive_integrity`: pass ([trace](logs/unit-tests.log))
- unit `helper_protocol.HelperProtocolTests.test_a_quarantine_keeps_every_file_unchanged_and_starts_an_empty_generation`: pass ([trace](logs/unit-tests.log))
- unit `helper_protocol.HelperProtocolTests.test_an_integrity_check_reads_without_changing_a_byte`: pass ([trace](logs/unit-tests.log))
- plugin `tests/quarantine_archive.test.tsx::damage met while settling a pending offers the same choices, not an endless reconciliation` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/quarantine_archive.test.tsx::a recheck that passes over an owed pending settles it first` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/quarantine_archive.test.tsx::a clear over an owed pending takes the pending with it` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/quarantine_archive.test.tsx::disabling the Run over an owed pending lets the prompt through and keeps the pending` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/quarantine_archive.test.tsx::enable that meets damage while settling a pending names the choices, not a read failure` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/quarantine_archive.test.tsx::damage another Run found stops this Run before it writes anything` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/quarantine_archive.test.tsx::late helper damage remains visible when ordinary success deletes an older display mirror` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- pty `PH-STORE-006` on 2.1.290: pass ([trace](pty/2.1.290/PH-STORE-006.txt))

### PH-STORE-007 迁移

Result: **pass**

Steps:
1. 用旧 schema 档案启动并迁移
1. 在各步骤中断
1. 打开高于支持版本的档案

Expected: 完整性检查、空间检查、私有备份、事务迁移、复检与下次打开后删备份全部通过；中断可恢复；高版本直接拒绝。

Actual: 9 pass

Evidence:
- plugin `tests/archive_unavailable.test.tsx::a migration that meets archive-integrity stops every Run of the project` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/archive_unavailable.test.tsx::a migration that meets migration-backup stops every Run of the project` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/archive_unavailable.test.tsx::a migration that meets migration-verify stops every Run of the project` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- unit `helper_protocol.HelperProtocolTests.test_a_schema_1_archive_migrates_without_losing_its_entries`: pass ([trace](logs/unit-tests.log))
- unit `helper_protocol.HelperProtocolTests.test_a_migration_keeps_a_private_backup_until_the_next_open`: pass ([trace](logs/unit-tests.log))
- unit `helper_protocol.HelperProtocolTests.test_a_migration_killed_at_any_moment_loses_nothing`: pass ([trace](logs/unit-tests.log))
- unit `helper_protocol.HelperProtocolTests.test_a_newer_schema_is_refused_before_anything_is_written`: pass ([trace](logs/unit-tests.log))
- unit `helper_protocol.HelperProtocolTests.test_a_disk_without_room_for_the_backup_refuses_the_migration`: pass ([trace](logs/unit-tests.log))
- unit `helper_protocol.HelperProtocolTests.test_an_archive_failing_its_integrity_check_is_not_migrated`: pass ([trace](logs/unit-tests.log))

### PH-STORE-008 Generation 竞争

Result: **failed**

Steps:
1. 两个 Run 持续提交时由第三方执行 `clear-all`

Expected: 切点前数据全部消失，切点后提交只进入新 generation，旧 writer 不复活记录。

Actual: 1 failed, 4 pass; 2.1.290: failed: the cut came after the held prompt landed

Evidence:
- plugin `tests/clear_all.test.tsx::a boundary owed to a cleared generation is dropped, not carried into the next` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/quarantine_archive.test.tsx::a capture meant for a generation another Run replaced starts over in the new one` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- unit `helper_protocol.HelperProtocolTests.test_writers_of_a_cleared_generation_leave_nothing_behind`: pass ([trace](logs/unit-tests.log))
- unit `helper_protocol.HelperProtocolTests.test_a_capture_meant_for_a_replaced_generation_stages_nothing`: pass ([trace](logs/unit-tests.log))
- pty `PH-STORE-008` on 2.1.290: failed ([trace](pty/2.1.290/PH-STORE-008.txt))

### PH-STORE-009 项目隔离

Result: **pass**

Steps:
1. 在两个项目根分别采集
1. 损坏其中一个
1. 在另一 worktree 与移动后的路径启动

Expected: 两个独立数据库，互不影响；不同 worktree 与路径移动后重新请求 consent。

Actual: 5 pass; 2.1.290: two project roots kept two archives; beta's damage held beta alone while alpha went on with a ready archive; a worktree of alpha and a project moved to another path were each asked for consent again and got an archive of their own, the old one left as it was

Evidence:
- plugin `tests/project_isolation.test.tsx::status reports this project alone, whatever another project holds` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/project_isolation.test.tsx::a Git project is rooted where Git says its working tree begins` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- unit `helper_protocol.HelperProtocolTests.test_one_projects_broken_archive_leaves_another_project_untouched`: pass ([trace](logs/unit-tests.log))
- unit `project_root.ProjectRootTests.test_a_worktree_is_a_project_root_of_its_own`: pass ([trace](logs/unit-tests.log))
- pty `PH-STORE-009` on 2.1.290: pass ([trace](pty/2.1.290/PH-STORE-009.txt))

### PH-FAIL-001 预写失败

Result: **pass**

Steps:
1. 让 Pending Capture 无法持久化后提交（PTY 对档案与 WAL 加 `chflags uchg`）

Expected: drop 本次提交并原样保留草稿。

Actual: 5 pass; 2.1.290: with the archive made immutable the pre-write failed as archive-read-only for every Run of the project; cancelled, the submission was dropped with its draft back whole, nothing staged, archived or sent; made writable again, a retry archived the next prompt

Evidence:
- plugin `tests/reconcile_pending.test.tsx::a failed pre-write drops the submission and restores the draft` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/archive_unavailable.test.tsx::a failed pre-write asks what to do, and cancelling keeps the draft` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- unit `helper_protocol.HelperProtocolTests.test_a_full_disk_stages_nothing_and_keeps_an_earlier_pending_whole`: pass ([trace](logs/unit-tests.log))
- unit `helper_protocol.HelperProtocolTests.test_an_archive_that_refuses_writes_is_read_only_and_stages_nothing`: pass ([trace](logs/unit-tests.log))
- pty `PH-FAIL-001` on 2.1.290: pass ([trace](pty/2.1.290/PH-FAIL-001.txt))

### PH-FAIL-002 后置确认失败

Result: **failed**

Steps:
1. 让确认失败后查看 UI 与 `status`，再提交

Expected: 保留 pending、阻止该 Run 后续提交并进入对账；不输出 prompt 原文。

Actual: 1 failed, 5 pass; 2.1.290: failed: sqlite3.OperationalError: database is locked

Evidence:
- plugin `tests/reconcile_pending.test.tsx::a failed confirmation keeps the pending and blocks the next submission` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/reconcile_pending.test.tsx::status reports the reconciliation and its event id without prompt text` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- unit `helper_protocol.HelperProtocolTests.test_confirm_from_pending_archives_the_staged_text`: pass ([trace](logs/unit-tests.log))
- plugin `tests/reconcile_pending.test.tsx::another live Run's reconciliation record is left to that Run` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/reconcile_pending.test.tsx::a Run's own pending leaves another Run's record as it was` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- pty `PH-FAIL-002` on 2.1.290: failed ([trace](pty/2.1.290/PH-FAIL-002.txt))

### PH-FAIL-003 Archive unavailable 操作

Result: **pass**

Steps:
1. 档案不可用时分别选择重试与禁用当前 Run 后继续

Expected: 只提供两种选择；禁用写入 Collection Boundary，不补录，不影响其他健康 Run。

Actual: 6 pass; 2.1.290: the busy archive offered only a retry and disabling the Run; a retry while busy asked again and sent nothing, once free it archived the prompt once; disabling let the prompt through unarchived behind one stop boundary, nothing from the disabled time was archived after enable, and the other Run went on along its branch

Evidence:
- plugin `tests/archive_unavailable.test.tsx::disabling the Run lets the prompt through unarchived behind a stop boundary` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/archive_unavailable.test.tsx::a retry after the archive recovers submits the same prompt once` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/archive_unavailable.test.tsx::a retry that fails again asks again, naming what it met this time` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/project_isolation.test.tsx::disabling this Run leaves another Run its branch, its owed writes and its archive` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- unit `helper_protocol.HelperProtocolTests.test_collection_boundaries_share_the_sequence_with_prompt_entries`: pass ([trace](logs/unit-tests.log))
- pty `PH-FAIL-003` on 2.1.290: pass ([trace](pty/2.1.290/PH-FAIL-003.txt))

### PH-FAIL-004 宿主级 fail-open

Result: **pass**

Steps:
1. 模拟 hook 崩溃与不可阻止的 lifecycle 写入失败（PTY 在提交等待写锁时 `SIGKILL` 宿主，并在写锁占住时执行 `/clear`；hook 抛出异常与恢复队列溢出只能改代码或大量操作造出，由 plugin test 证明）
1. 再次提交

Expected: 优先用 transcript 与 `$.store` 恢复队列对账；无法唯一恢复时写入显著、不可变的 Integrity Gap。

Actual: 5 pass; 2.1.290: a host killed while its submission waited on a busy archive left no pending; resumed, the Run wrote one Integrity gap and its recovery ahead of its next prompt and archived nothing of the lost one; a /clear while the archive was busy was recorded from the host's store at the next submission, ahead of it, with no gap

Evidence:
- plugin `tests/integrity_gap.test.tsx::a marker left before a pending was staged is a prompt the host let through: a gap` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/integrity_gap.test.tsx::an overflowed recovery queue leaves a gap and its recovery ahead of the next Prompt Entry` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/integrity_gap.test.tsx::a marker left after a pending was staged is settled by reconciliation, not a gap` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- unit `helper_protocol.HelperProtocolTests.test_an_integrity_gap_and_its_recovery_are_boundaries_of_their_run`: pass ([trace](logs/unit-tests.log))
- pty `PH-FAIL-004` on 2.1.290: pass ([trace](pty/2.1.290/PH-FAIL-004.txt))

### PH-FAIL-005 Gap 后恢复

Result: **pass**

Steps:
1. 留下 Gap 后恢复采集
1. 查看 band 与 `status`
1. 执行 `clear-run`

Expected: 写入闭合边界，历史 Gap 永久可见；只有删除相应范围的清除才移除标记。

Actual: 6 pass; 2.1.290: the gap and its recovery stood on the band and status counted one; it stayed after a restart and a clear of another Run, and went with a clear of the Run that held it

Evidence:
- plugin `tests/integrity_gap.test.tsx::status says a gap is owed, then that the project’s history holds one` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/integrity_gap.test.tsx::a gap already owed is written once however often the drain is retried` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/integrity_gap.test.tsx::a Run clear forgets the gap the Run owed, its losses and its stale markers` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/integrity_gap.test.tsx::a clear-all forgets every gap owed and every marker no live Run holds` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- unit `helper_protocol.HelperProtocolTests.test_archive_status_counts_the_integrity_gaps_left_in_the_archive`: pass ([trace](logs/unit-tests.log))
- pty `PH-FAIL-005` on 2.1.290: pass ([trace](pty/2.1.290/PH-FAIL-005.txt))

### PH-FAIL-006 代表性真实宿主故障

Result: **failed**

Steps:
1. 在真实宿主中依次注入 locator/helper 不可用、提交失败关闭、重试、禁用后继续、busy、损坏与物理删除残留（locator 不可用为运行中把 locator 放宽为 0644）

Expected: 每种故障均按对应场景的约定表现。

Actual: 1 failed, 1 pass; 2.1.290: failed: timed out waiting for the reconciliation notice

Evidence:
- plugin `tests/archive_unavailable.test.tsx::a helper the host killed is this Run's failure, named without the host's words` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- pty `PH-FAIL-006` on 2.1.290: failed ([trace](pty/2.1.290/PH-FAIL-006.txt))

### PH-CONTROL-001 status

Result: **pass**

Steps:
1. 在健康、失败与有 Gap 的状态下执行 `/prompt-history status`

Expected: 只显示 consent、Run 模式、健康、Gap 提示、项目路径、数据库路径与大小；不显示 prompt；失败状态下仍可用。

Actual: 8 pass; 2.1.290: healthy: consent, Run mode, health, project, database path and 94208 bytes; 5 Integrity gaps counted; damaged: archive-integrity with its choices; no line beyond the contract's and no prompt text in any

Evidence:
- plugin `tests/collection_mode.test.tsx::status reports consent, policy version, Run mode and the latest boundary` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/run_identity.test.tsx::status names the current Run` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/quarantine_archive.test.tsx::status names the generation, each quarantined archive and the choices` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- unit `helper_protocol.HelperProtocolTests.test_archive_status_names_the_generation_and_each_quarantined_archive`: pass ([trace](logs/unit-tests.log))
- plugin `tests/consent_capture.test.tsx::status gives the size of the archive in place, or says it is unknown` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/startup_refusal.test.tsx::an archive the helper cannot check is unknown, not said never to exist` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- unit `helper_protocol.HelperProtocolTests.test_archive_status_gives_the_size_of_the_archive_in_place`: pass ([trace](logs/unit-tests.log))
- pty `PH-CONTROL-001` on 2.1.290: pass ([trace](pty/2.1.290/PH-CONTROL-001.txt))

### PH-CONTROL-002 Enable/disable

Result: **pass**

Steps:
1. 首次 enable
1. disable 后提交
1. 带 pending 时重新 enable

Expected: 首次 enable 先 preflight 与 consent；disable 只影响当前 Run 且不删除；重新 enable 先解决 pending 再写边界并从新根分支开始。

Actual: 6 pass; 2.1.290: enable asked for consent first, then recorded the start; disabled, a prompt was neither archived nor staged and nothing was deleted; with a pending owed, enable settled it from its stored row, then wrote the resume, and the next prompt started its new root branch

Evidence:
- plugin `tests/collection_mode.test.tsx::enable on an unconsented project asks first, then starts collection` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/collection_mode.test.tsx::disable stops this Run without deleting entries or revoking consent` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/collection_mode.test.tsx::re-enabling starts a new root Conversation Branch and back-fills nothing` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/reconcile_pending.test.tsx::disable keeps the pending and enable refuses until it is reconciled` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- unit `helper_protocol.HelperProtocolTests.test_collection_boundaries_share_the_sequence_with_prompt_entries`: pass ([trace](logs/unit-tests.log))
- pty `PH-CONTROL-002` on 2.1.290: pass ([trace](pty/2.1.290/PH-CONTROL-002.txt))

### PH-DELETE-001 clear-run

Result: **pass**

Steps:
1. 有数据时执行 `/prompt-history clear-run` 并确认
1. 存在 Quarantined Archive 时再执行

Expected: 显示 Run、记录数与副本边界并确认；只删除当前 Run 的记录；有隔离档案时拒绝声称完整删除。

Actual: 6 pass; 2.1.290: the confirmation counted 2 entries of this Run; cancelling removed nothing; confirming removed this Run's records and left the other Run's as they were; with a quarantined archive clear-run refused and pointed to clear-all

Evidence:
- plugin `tests/clear_run.test.tsx::clear-run shows the Run it removes and cancelling removes nothing` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/clear_run.test.tsx::a confirmed clear-run removes this Run and leaves every other Run as it was` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/clear_run.test.tsx::clear-run refuses while the project holds a quarantined archive` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- unit `helper_protocol.HelperProtocolTests.test_a_run_clear_removes_that_runs_records_and_keeps_every_other_run`: pass ([trace](logs/unit-tests.log))
- unit `helper_protocol.HelperProtocolTests.test_a_run_clear_refuses_while_the_project_has_a_quarantined_archive`: pass ([trace](logs/unit-tests.log))
- pty `PH-DELETE-001` on 2.1.290: pass ([trace](pty/2.1.290/PH-DELETE-001.txt))

### PH-DELETE-002 clear-all

Result: **pass**

Steps:
1. 有数据时执行 `/prompt-history clear-all` 并输入固定短语

Expected: 删除活动 DB、WAL/SHM、迁移备份、Quarantined Archive 与全部 prompt 元数据，保留 consent 与 Run 模式，建立空 generation。

Actual: 6 pass; 2.1.290: the confirmation listed the quarantined archive; a mistyped phrase removed nothing; the phrase removed the active archive with its WAL/SHM and the quarantine, leaving only the two stable locks; consent and the Run mode stayed; the next prompt started a new generation with no consent question

Evidence:
- plugin `tests/clear_all.test.tsx::clear-all shows what it removes and clears only on the exact phrase` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/clear_all.test.tsx::after a clear the Run goes on collecting in an empty timeline` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- unit `helper_protocol.HelperProtocolTests.test_a_clear_removes_every_file_the_project_archived_and_nothing_else`: pass ([trace](logs/unit-tests.log))
- plugin `tests/clear_all.test.tsx::a first clear of a damaged archive says it was damaged` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/clear_all.test.tsx::after a clear status says no archive is in place` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- pty `PH-DELETE-002` on 2.1.290: pass ([trace](pty/2.1.290/PH-DELETE-002.txt))

### PH-DELETE-003 无数据与残留

Result: **pass**

Steps:
1. 无数据时执行两种清除
1. 锁住 WAL 或备份后执行清除（PTY 用 `chflags uchg` 锁住 `clear-all` 的 WAL；`clear-run` 要先写库、VACUUM 与截断 WAL，外部锁定会让它更早以别的错误失败，其残留由 plugin test 与 helper 单测证明）

Expected: 无目标时 no-op 不询问；物理清除失败时报告「逻辑删除完成、物理清除未完成」并列出残留，维持 Archive unavailable。

Actual: 10 pass; 2.1.290: with nothing archived both clears answered without asking; a WAL made immutable left the clear logically done and physically unfinished, listed in the answer and in status, holding the next submission; once the WAL could go, clear-all finished without the phrase and the next prompt was archived

Evidence:
- plugin `tests/clear_all.test.tsx::clear-all with nothing archived asks nothing and removes nothing` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/clear_all.test.tsx::a clear that leaves files behind says what is left and holds the archive` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/clear_run.test.tsx::clear-run with nothing of this Run archived asks nothing and removes nothing` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/clear_run.test.tsx::a Run clear that cannot empty the WAL says what is left and holds every submission` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- unit `helper_protocol.HelperProtocolTests.test_a_clear_with_nothing_archived_does_nothing`: pass ([trace](logs/unit-tests.log))
- unit `helper_protocol.HelperProtocolTests.test_a_clear_that_leaves_a_file_behind_refuses_the_archive_until_one_finishes`: pass ([trace](logs/unit-tests.log))
- unit `helper_protocol.HelperProtocolTests.test_a_run_clear_with_nothing_of_that_run_does_nothing`: pass ([trace](logs/unit-tests.log))
- plugin `tests/clear_all.test.tsx::finishing a clear whose archive is already gone does not call it damaged` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/clear_all.test.tsx::a clear another Run began during the confirmation is not called damage` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- pty `PH-DELETE-003` on 2.1.290: pass ([trace](pty/2.1.290/PH-DELETE-003.txt))

### PH-DELETE-004 删除边界告知

Result: **pass**

Steps:
1. 执行两种清除并阅读确认对话

Expected: 重申不删除 Claude Code transcript/history、文件系统快照与外部备份，也不保证 SSD 介质不可恢复擦除。

Actual: 4 pass; 2.1.290: both confirmations say they leave the transcript/history, filesystem snapshots and third-party backups alone and promise no SSD erasure

Evidence:
- plugin `tests/clear_all.test.tsx::clear-all shows what it removes and clears only on the exact phrase` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/clear_run.test.tsx::clear-run shows the Run it removes and cancelling removes nothing` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- unit `helper_protocol.HelperProtocolTests.test_a_clear_inventory_lists_what_a_clear_would_remove_without_changing_it`: pass ([trace](logs/unit-tests.log))
- pty `PH-DELETE-004` on 2.1.290: pass ([trace](pty/2.1.290/PH-DELETE-004.txt))

### PH-SEC-001 唯一标记扫描

Result: **pass**

Steps:
1. 每个场景使用不可猜测的合成标记
1. 扫描隔离环境、trace 与报告中的全部文件，并采样 argv

Expected: 标记只出现在档案 SQLite、`timeline-read` 响应与当下允许显示的 UI；其他任何出现都阻断发布。

Actual: 5 pass; 2.1.290: the scan found a planted marker and passed over the archive; the prompt stood in the archive and the band, not in status, a clear confirmation or the damage dialog; 1511 files scanned, 8 archive or host files passed over, no argv held it

Evidence:
- plugin `tests/consent_capture.test.tsx::enabled consent stages through stdin and confirms the final prompt atomically` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- unit `helper_protocol.HelperProtocolTests.test_capture_list_reports_unresolved_pendings_without_prompt_text`: pass ([trace](logs/unit-tests.log))
- unit `helper_protocol.HelperProtocolTests.test_branch_match_refuses_malformed_rows_without_echoing_them`: pass ([trace](logs/unit-tests.log))
- gate `privacy-scan`: pass
- pty `PH-SEC-001` on 2.1.290: pass ([trace](pty/2.1.290/PH-SEC-001.txt))

### PH-SEC-002 stdin 与诊断

Result: **failed**

Steps:
1. 在各失败路径中检查 helper 的输入与诊断

Expected: helper 只从 stdin 接收原文；诊断只含随机事件 ID、sequence、错误码与必要路径。

Actual: 1 failed, 5 pass; 2.1.290: failed: timed out waiting for the 档案不可用 dialog

Evidence:
- plugin `tests/startup_refusal.test.tsx::reports system execution refusal without leaking its error` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/startup_refusal.test.tsx::sanitizes a non-JSON helper execution refusal` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- plugin `tests/reconcile_pending.test.tsx::status reports the reconciliation and its event id without prompt text` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- unit `helper_protocol.HelperProtocolTests.test_capture_rejects_prompt_bytes_that_are_not_valid_utf8`: pass ([trace](logs/unit-tests.log))
- unit `helper_protocol.HelperProtocolTests.test_capture_list_reports_unresolved_pendings_without_prompt_text`: pass ([trace](logs/unit-tests.log))
- pty `PH-SEC-002` on 2.1.290: failed ([trace](pty/2.1.290/PH-SEC-002.txt))

### PH-SEC-003 私有权限

Result: **pass**

Steps:
1. 在创建、迁移、隔离、清除与异常恢复后检查目录与文件权限（迁移备份只存活到下一次打开档案，PTY 以 50 ms 采样尽量捕捉，其权限由 helper 单测证明）

Expected: 目录始终 `0700`，数据库、locator、备份与隔离文件始终 `0600`。

Actual: 6 pass; 2.1.290: directories 0700 and files 0600 after migration, quarantine, clear, creation, recovery from an unfinished clear, and in every 50 ms sample between; the migration backup stood too briefly to be sampled; its mode is the helper unit test's

Evidence:
- unit `bridge_protocol.BridgeProtocolTests.test_publish_creates_only_a_private_session_locator`: pass ([trace](logs/unit-tests.log))
- unit `bridge_protocol.BridgeProtocolTests.test_the_session_index_holds_identity_only_in_a_private_file`: pass ([trace](logs/unit-tests.log))
- unit `helper_protocol.HelperProtocolTests.test_a_migration_keeps_a_private_backup_until_the_next_open`: pass ([trace](logs/unit-tests.log))
- unit `helper_protocol.HelperProtocolTests.test_a_quarantine_keeps_every_file_unchanged_and_starts_an_empty_generation`: pass ([trace](logs/unit-tests.log))
- plugin `tests/startup_refusal.test.tsx::rejects a widened locator before trusting its artifact status` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- pty `PH-SEC-003` on 2.1.290: pass ([trace](pty/2.1.290/PH-SEC-003.txt))

### PH-SEC-004 无隐式副作用

Result: **failed**

Steps:
1. 在各失败路径中观察网络、编译、xattr 与数据删除

Expected: 不联网、不现场编译、不修改 xattr 或系统安全策略、不自动删除数据、不创建伪完整的内存 fallback。

Actual: 1 failed, 2 pass; 2.1.290: failed: timed out waiting for the held prompt to be staged

Evidence:
- unit `artifact_static.StaticArtifactTests.test_startup_runtime_has_no_forbidden_side_effect_surface`: pass ([trace](logs/unit-tests.log))
- plugin `tests/startup_refusal.test.tsx::rejects an incompatible helper protocol before execution` on 2.1.290: pass ([trace](logs/plugin-tests@2.1.290.log))
- pty `PH-SEC-004` on 2.1.290: failed ([trace](pty/2.1.290/PH-SEC-004.txt))
