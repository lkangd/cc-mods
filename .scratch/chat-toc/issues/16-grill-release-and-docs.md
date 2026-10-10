# 决定首个版本的发布形态与文档

Type: grilling
Status: resolved
Blocked by: 

## Question

chat-toc 首个版本怎么发布、怎么写文档：marketplace 条目怎么写（名称、描述、分类、与 prompt-history 并列时如何说明两者独立、可同时启用）；根 README 新增的一节写什么，其中要包含「定稿兼容与验收契约」的不承诺清单、最低版本 `>=2.1.287`、仅全屏停靠、不能停靠时看状态栏说明；`mods/chat-toc/` 自己的 README 是否需要、写什么（三种 Layout、View filter、热键 1/2/3、`l`、↑↓/Enter、`/chat-toc`）；首个版本号是多少，与 `mods/chat-toc/tests/evidence/<插件版本>/` 报告目录如何对应。可借鉴 prompt-history 0.3.0 的发布做法与根 README 现有结构。

## Answer

**结论：首个版本 `0.1.0`；根 README 写唯一一份用户文档，`mods/chat-toc/README.md` 只写开发与发布；marketplace 条目、README 那一节和证据报告在 MUST 全部通过后放进同一个发布提交，不打 tag。** 2026-10-09 与使用者两轮逐条确认。

### 1. 版本号与证据目录

- 首个版本 `0.1.0`。`plugin.json` 和 marketplace 条目两处都写（manifest 的 `version` 优先）。
- 一个版本一个目录：`mods/chat-toc/tests/evidence/<版本>/`。每次改版本号都在新目录里重跑完整 MUST 门禁，旧目录保留不改；报告记录被测的提交哈希。
- 目录里放三个文件：`report.md`（给人看，含人工目检签字）、`report.json`（字段照「定稿兼容与验收契约」§6）、`marketplace.md`（本地目录 marketplace 冒烟加 GitHub 安装级检查的结果）。两个 Claude Code 版本写在同一份报告里，按版本分列。
- 不建 CHANGELOG，版本历史就是证据目录加提交记录。

### 2. marketplace 条目

```json
{
  "name": "chat-toc",
  "source": "./mods/chat-toc",
  "description": "A docked table of contents of the current Claude Code session; jump to any turn.",
  "version": "0.1.0",
  "author": { "name": "chat-toc contributors" }
}
```

不加 `category`/`tags`（只有两个插件，分类没有用处，prompt-history 也没加）。条目里不提与 prompt-history 的关系，独立性只在 README 里说明。

### 3. 发布动作

- marketplace 读的是 GitHub 上的 main，条目进 main 就等于发布。
- 插件代码可以先合进 main，但 marketplace 条目、根 README 一览表的一行和 chat-toc 一节、`evidence/0.1.0/` 报告要放在**同一个发布提交**里，在全部 MUST 通过之后最后提交。不打 git tag。
- `CT-COMPAT-002` 冒烟在发布前用**本地目录 marketplace** 跑，两个版本都跑。发布提交推上去后，再从 `lkangd/cc-mods` 做一次安装级检查（添加、安装、版本号、enabled、Pane 弹出），结果补进 `marketplace.md`。补这一步不算重新发布；检查失败就撤回发布提交。原因：本地目录 marketplace 直接运行源码目录，只有 GitHub 远程 marketplace 才复制到缓存（prompt-history 0.3.0 的发现）。

### 4. 根 README

- 开头那段改成：每个 mod 是独立插件，互不依赖、不共享代码与数据，可以同时启用。
- 一览表新增一行：`chat-toc | 0.1.0 | 在对话右侧停靠当前会话的目录，点击跳回任意一轮`。
- chat-toc 一节与 prompt-history 一节同级，开头一句写两者的区别：chat-toc 什么都不保存、只显示当前会话；prompt-history 保存 prompt 原文档案；两者可以同时启用，一个在输入框上方，一个停靠在右侧。
- 一节内部按顺序写：
  1. 一句话作用；
  2. **环境要求**：`>=2.1.287`（`claude --version`）、交互式终端、全屏布局、终端足够宽；不需要 `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS`；OS 不限，只在 macOS 上实测过；
  3. **安装**：marketplace 或 `--plugin-dir` 二选一，不同时启用；
  4. **快速开始**：Pane 自动停靠在右侧，没出现就看状态栏说明；
  5. **操作**：一张表，列点击用户侧和 Agent 侧、聚焦时 ↑↓/Enter、1/2/3、`l` 与「布局:」按钮、✕ 关闭本会话、`/chat-toc`（打开、提前、聚焦，从不关闭）；
  6. **显示规则**：每个条目是一轮对话（你的一次输入加上 Agent 的回复），以及「N 步」「进行中」「无文字回复」、时间读不到不显示、淡化条目为什么不能跳转、青色高亮跟随对话位置、手动滚动时显示「暂停」、`/clear`/compact/rewind 后的表现；界面文字是中文；
  7. **数据与隐私**：只读当前会话 transcript，不建档案、不联网；`$.store` 只存 View filter 与 Layout；
  8. **卸载**：`claude plugin uninstall chat-toc@cc-mods`，并写出残留的 `$.store` 文件位置；
  9. **已知限制**：契约 §5 的不承诺清单七条，改写成面向使用者的话；
  10. **开发**：一行链接到 `mods/chat-toc/README.md` 和证据目录，并写 0.1.0 的通过结果。
- README 不用 Turn group、Current position 等内部术语，一律用界面上的字。

### 5. `mods/chat-toc/README.md`

只写开发者内容：链接到根 README 和 `CONTEXT.md`；目录结构；本地加载；`claude plugin test` 的跑法；cmux PTY 验收怎么跑；证据目录约定；**发布清单**，按顺序勾选：两个版本跑全部 MUST → 本地目录 marketplace 冒烟 → 人工目检签字 → 发布提交 → GitHub 安装级检查 → 失败就撤回。

### 其他

不改 `CONTEXT.md`（全是发布与文档用语，不是领域术语）；不写 ADR（改起来便宜）。没有新的迷雾，也没有新票。

## 后续修订

- 2026-10-10：不承诺清单新增「`/chat-toc` 主动打开时的 inline 形态未经验收」，README 已知限制随之变为八条。见「定稿兼容与验收契约」的后续修订。
