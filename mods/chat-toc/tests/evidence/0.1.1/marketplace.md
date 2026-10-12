# chat-toc 0.1.1 的 marketplace 结果

## 发布前：本地目录 marketplace 冒烟（CT-COMPAT-002）

- 脚本：`tests/acceptance/ct_marketplace.py --source local`（发布门禁 `release_gate.py run` 的一步），被测提交 `3777ac2`。当时 `.claude-plugin/marketplace.json` 里 chat-toc 条目的 `version` 还是 0.1.0（发布提交才改成 0.1.1）；本地目录 marketplace 直接读源目录，装上的是源目录 `plugin.json` 的 0.1.1。
- 隔离世界：临时 HOME 与 `CLAUDE_CONFIG_DIR`、未登录、没有 `--plugin-dir`，不调用模型。
- 步骤：`claude plugin marketplace add <repo>` → `claude plugin install chat-toc@cc-mods` → `claude plugin list` → 全屏会话 `--resume` 一份 12 轮的合成 transcript → 等 Pane 自己停靠 → 点 T0000 的用户侧。

| Claude Code | add / install / list | `plugin list` | 加载为 | Pane 自动停靠 | 点击跳转 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| 2.1.287 | 0 / 0 / 0 | `chat-toc@cc-mods` 0.1.1 enabled | `chat-toc@cc-mods` | 是 | T0000 到了视口顶部 | 通过 |
| 2.1.295 | 0 / 0 / 0 | `chat-toc@cc-mods` 0.1.1 enabled | `chat-toc@cc-mods` | 是 | T0000 到了视口顶部 | 通过 |

证据：`pty/2.1.287/ct-marketplace/`、`pty/2.1.295/ct-marketplace/`（命令输出 `commands-local-*.txt`、debug 日志里 chat-toc 的行、截屏、`run.jsonl`）。

## 发布后：从 GitHub 的安装级检查

待推送后补。
