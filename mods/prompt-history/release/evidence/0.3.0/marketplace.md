# Marketplace 模式 PTY 结果（0.3.0）

- 加载方式：`PROMPT_HISTORY_PTY_INSTALL=marketplace`。仓库作为本地目录 marketplace 添加，每个场景在自己的配置里安装 `prompt-history@cc-mods`，插件本体不经 `--plugin-dir` 加载。
- 宿主：Claude Code 2.1.290，模型 haiku。
- 同一套场景的 `--plugin-dir` 模式：全量门禁 56/56 通过（`report.md`，提交 059ee2d）。

## 结果

| 运行 | 结果 |
| --- | --- |
| 首轮全量（`marketplace-first-run/`，harness 修改前） | 48 通过，8 失败 |
| 8 个失败场景复跑 | PH-UI-004、PH-UI-008 通过（首轮失败，判为波动）；其余 6 个仍失败 |
| 夹具改为从独立 marketplace 安装 | PH-FAIL-002、PH-STORE-008 通过；其余 4 个仍失败 |
| 加载自建副本时停用已安装插件 | PH-SEC-001、PH-COMPAT-005 通过；其余 4 个仍失败 |
| **当前** | **52/56 通过；4 个未通过：PH-SEC-002、PH-FAIL-006、PH-SEC-004、PH-COMPAT-003** |

## 未通过的 4 个场景

- 共同点：都会中途加载自建副本或使用下游夹具，并在档案不可用、不可信 helper 或宿主退出等阶段等待界面或进程状态。
- 已排除：不是 marketplace 安装本身。其余 52 个场景（安装、状态、采集、生命周期、分支、跳转、界面、删除、故障注入中的其他场景）在 marketplace 模式下通过。同样 4 个场景在 `--plugin-dir` 模式下全部通过。
- 未确认：根因未查明。已试的修法：夹具改由独立 marketplace 安装（修好了 2 个）；把自建副本覆盖到已安装副本（无效：本地目录 marketplace 运行的是源目录，`status` 显示的 helper 路径即仓库路径）；加载自建副本时停用已安装插件（修好了 2 个，其余 4 个仍失败）。
- 因此这 4 个场景在 marketplace 模式下不作为已验证项；它们的 `--plugin-dir` 结果见 `report.md`。

## 说明

- 本地目录 marketplace 的运行文件就是仓库源目录；GitHub 远程 marketplace 才会复制到缓存目录。本轮 PTY 只覆盖本地目录方式。
- 发布后的 GitHub 安装只做了安装级检查（添加、安装、版本与启用状态），未再跑 PTY。
