# chat-toc 0.2.0 的 marketplace 结果

## 发布前：本地目录 marketplace 冒烟（CT-COMPAT-002）

- 脚本：`tests/acceptance/ct_marketplace.py --source local --host 2.1.287 --host current`，2026-10-19，在版本号提交 `1cd431d` 上单独重跑（发布门禁 2026-10-17 那次跑的时候 `plugin.json` 还是 0.1.3，装上的是 0.1.3，已被这次替换）。当时 `.claude-plugin/marketplace.json` 里 chat-toc 条目的 `version` 还是 0.1.3（发布提交才改成 0.2.0）；装上的是源目录 `plugin.json` 的 0.2.0。
- 隔离世界：临时 HOME 与 `CLAUDE_CONFIG_DIR`、未登录、没有 `--plugin-dir`，不调用模型。
- 步骤：`claude plugin marketplace add <repo>` → `claude plugin install chat-toc@cc-mods` → `claude plugin list` → 全屏会话 `--resume` 一份 12 轮的合成 transcript → 等 Pane 自己停靠 → 点 T0000 的用户侧。

| Claude Code | add / install / list | `plugin list` | 加载为 | Pane 自动停靠 | 点击跳转 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| 2.1.287 | 0 / 0 / 0 | `chat-toc@cc-mods` 0.2.0 enabled | `chat-toc@cc-mods` | 是 | T0000 到了视口顶部 | 通过 |
| 2.1.295 | 0 / 0 / 0 | `chat-toc@cc-mods` 0.2.0 enabled | `chat-toc@cc-mods` | 是 | T0000 到了视口顶部 | 通过 |

证据：`pty/2.1.287/ct-marketplace/`、`pty/2.1.295/ct-marketplace/`（命令输出 `commands-local-*.txt`、debug 日志里 chat-toc 的行、截屏、`run.jsonl`）。

会话中途经 marketplace 启用（CT-LIFE-007）另用运行目录里临时搭的目录 marketplace，见 `report.md` 与 `pty/<版本>/ct-mid-session/`。
