# chat-toc 0.1.0 的 marketplace 结果

## 发布前：本地目录 marketplace 冒烟（CT-COMPAT-002）

- 脚本：`tests/acceptance/ct_marketplace.py --source local`（发布门禁 `release_gate.py run` 的一步），被测提交 `a83f74c205023e18d204caef32491840cda0f0c2`，工作区里另有发布提交要加的 `.claude-plugin/marketplace.json` 的 chat-toc 条目（与发布提交里的内容相同）。
- 隔离世界：临时 HOME 与 `CLAUDE_CONFIG_DIR`、未登录、没有 `--plugin-dir`，不调用模型。
- 步骤：`claude plugin marketplace add <repo>` → `claude plugin install chat-toc@cc-mods` → `claude plugin list` → 全屏会话 `--resume` 一份 12 轮的合成 transcript → 等 Pane 自己停靠 → 点 T0000 的用户侧。

| Claude Code | add / install / list | `plugin list` | 加载为 | Pane 自动停靠 | 点击跳转 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| 2.1.287 | 0 / 0 / 0 | `chat-toc@cc-mods` 0.1.0 enabled | `chat-toc@cc-mods` | 是（`ui.open … (unasked …): placed`） | T0000 到了视口顶部 | 通过 |
| 2.1.295 | 0 / 0 / 0 | `chat-toc@cc-mods` 0.1.0 enabled | `chat-toc@cc-mods` | 是 | T0000 到了视口顶部 | 通过 |

证据：`pty/2.1.287/ct-marketplace/`、`pty/2.1.295/ct-marketplace/`（命令输出 `commands-local-*.txt`、debug 日志里 chat-toc 的行、截屏、`run.jsonl`）。

说明：本地目录 marketplace 直接读仓库里的源目录（2.1.295 的 `plugin list` 显示 `Read from: <repo>/mods/chat-toc`）；只有 GitHub 远程 marketplace 才克隆仓库再复制进缓存，所以下面的安装级检查不能省。

## 发布后：从 GitHub 的安装级检查

- 脚本：`tests/acceptance/ct_marketplace.py --source github --host 2.1.287 --host current`，2026-10-11 20:22（UTC+8），main 在发布提交 `b3396e6`。隔离世界、未登录、没有 `--plugin-dir`，不调用模型。
- 步骤：`claude plugin marketplace add lkangd/cc-mods`（宿主经 HTTPS 克隆仓库默认分支 main）→ `claude plugin install chat-toc@cc-mods`（复制进 `plugins/cache/cc-mods/chat-toc/0.1.0/`）→ `claude plugin list` → 全屏会话 `--resume` 一份 12 轮的合成 transcript → Pane 自动停靠 → 点 T0000 的用户侧。

| Claude Code | add / install / list | `plugin list` | 加载为 | Pane 自动停靠 | 点击跳转 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| 2.1.287 | 0 / 0 / 0 | `chat-toc@cc-mods` 0.1.0 enabled | `chat-toc@cc-mods` | 是 | T0000 到了视口顶部 | 通过 |
| 2.1.295 | 0 / 0 / 0 | `chat-toc@cc-mods` 0.1.0 enabled | `chat-toc@cc-mods` | 是 | T0000 到了视口顶部 | 通过 |

证据：`github-install/`（命令输出、debug 日志里 chat-toc 的行、截屏、`run.jsonl`）。

经过：第一次发布（`066d082`）后的同一检查在两个版本上都失败了：当时仓库默认分支是 `prompt-trail/issue-39-pty-compat-failures`，`marketplace add lkangd/cc-mods` 克隆到的 marketplace 里没有 chat-toc，`plugin install` 报 not found。发布提交因此被撤回（`abd2e8b`）。使用者把默认分支改成 main 后重新发布（`b3396e6`，内容与 `066d082` 相同），本节是重新发布后的结果。
