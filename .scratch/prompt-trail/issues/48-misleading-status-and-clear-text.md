# 48: status 与清除回复中的误导性文字

**What to build:** Issue 40 的 PTY 场景在真实宿主里读到三处与事实不符的文字：

1. status 的 `Archive generation` 只显示 generation 的前 12 个字符。generation 是「设备号-inode-创建时间」，前 12 个字符只是设备号加 inode 的高几位，隔离、清除前后实测都是 `1000012-1f6c`，读起来像 generation 没有变。
2. 接着完成一次未完成的 `clear-all` 时，回复说「已清除本项目的 Prompt Trail 档案：损坏的活动档案（条数无法读取）」。档案并没有损坏，是上一次清除已经删掉了它，所以读不到条数。
3. helper 不可用（或目标不受支持）时，status 写 `archive: not created`；档案其实在磁盘上，只是插件无法证明它的状态。

**Blocked by:** —

**Status:** resolved

- [x] 先写 plugin test，在原代码上确认变红：
  - status 显示的 generation 能区分两个不同的 generation；
  - 接着完成未完成的清除、条数读不到时，回复不说档案损坏；
  - helper 不可用时，status 的 `archive:` 不说 `not created`。
- [x] 修改插件的这三处文字；首次清除时档案确实损坏的说法不变，没有档案的受支持目标仍是 `not created`。
- [x] PTY：Issue 40 的场景按新文字断言。

## Answer

- **修复**（`hooks/register.tsx`）：
  1. status 的 `Archive generation` 显示完整的 generation（如 `1000012-1f5023aa-6ab9f774-350e89d`），不再截成 12 个字符。选项里写的是「短哈希」，实现时改用完整值：它本来就能区分，也不必再引入一个没有解释的哈希。
  2. `clearedText` 多一个参数，表示是否在接着完成一次未完成的清除。接着完成且条数读不到时，写「活动档案（条数无法读取，可能已在上一次清除中删除）」；第一次清除时读不到，仍写「损坏的活动档案（条数无法读取）」。
  3. 目标不受支持或 helper 不可用、又没有档案失败记录时，status 写 `archive: unknown · <support>，无法检查档案`；受支持且没有档案时仍是 `not created`。
- **plugin test**：
  - `quarantine_archive.test.tsx::status names the generation, each quarantined archive and the choices` 改为要求整行是完整的 generation（原代码变红）；
  - `clear_all.test.tsx::finishing a clear whose archive is already gone does not call it damaged`（原代码变红），以及护栏 `a first clear of a damaged archive says it was damaged`；测试桩为此加了 `clearCountsUnknown`；
  - `startup_refusal.test.tsx::an archive the helper cannot check is unknown, not said never to exist`（原代码变红）。
- **PTY**：PT-DELETE-002 用 status 显示的 generation 证明清除后换了 generation；PT-DELETE-003 要求接着完成的清除不说「损坏」；故障巡回（PT-SEC-002/004）要求 helper 不可用时写 `archive: unknown`。两个版本都通过。
- **scenarios.json**：PT-CONTROL-001 引用 startup_refusal 那一项；PT-DELETE-003、PT-DELETE-002 分别引用 clear_all 的两项。

## Comments

### 2026-09-30 · 从 Issue 40 拆出

在 2.1.283 上跑 PT-DELETE-002、PT-SEC-003、PT-SEC-002 时读到。使用者决定三处合为一张票，在本分支修，本票挡住 40。

### Code review 修复（2026-09-30，round 1）

- status 的 `archive:` 行在 `clear-all` 之后仍显示 `ready`（`archiveReady` 从不复位），会写出 `ready · <路径> · 0 bytes`。现在先判断目标是否受支持，再要求 `archive-status` 没有报「路径上没有档案」（`generation: null`）才写 `ready`。测试桩按真实 helper 改为：清除后在下一次写入之前 `archive-status` 的 generation 为 `null`。新增 `clear_all.test.tsx::after a clear status says no archive is in place`，在原代码上变红。
- `clearedText` 的判断改为：只有确认前的清单本身也数不出条数、且当时没有未完成的清除时，才说「损坏的活动档案」。这样，另一个 Run 在确认对话期间开始并删掉档案的情况，也不会被说成损坏。新增 `clear_all.test.tsx::a clear another Run began during the confirmation is not called damage`，在原代码上变红；测试桩的 `clearCountsUnknown` 同时作用于清单。
