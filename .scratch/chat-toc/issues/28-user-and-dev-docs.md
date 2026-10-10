# 28: 用户文档与开发文档

**What to build:** 想安装的人在根 README 里就能读到 chat-toc 的环境要求、安装、操作、显示规则、隐私、卸载和已知限制；开发者在插件自己的 README 里能找到本地加载、测试、PTY 验收和发布清单。

规格见 [chat-toc MVP](../spec.md) §10。

**Blocked by:** 21（对话链：compact、rewind、resume、fork）、23（完整跳转：Agent 侧、兜底与被拒）、25（View filter、三种 Layout 与键盘）、26（停靠条件与状态栏说明）

**Status:** ready-for-agent

- [ ] 根 README 开头改为「每个 mod 是独立插件，互不依赖、不共享代码与数据，可以同时启用」；一览表新增 chat-toc 一行（版本先写 0.1.0，随发布提交一起出现）
- [ ] chat-toc 一节与 prompt-history 同级，开头写两者的区别，然后按序：作用、环境要求（含「不需要 function hooks 环境变量」、OS 不限但只在 macOS 实测）、安装、快速开始、操作表、显示规则、数据与隐私、卸载（含残留 `$.store` 文件位置）、已知限制（不承诺八条）、开发
- [ ] 用界面上的字，不出现 Turn group、Current position 等内部术语
- [ ] 插件 README 只写开发内容：链接根 README 与 CONTEXT、目录结构、本地加载、`claude plugin test`、cmux PTY 验收、证据目录约定、发布清单（逐步勾选）
- [ ] 文档描述与实际行为一致（逐条对照规格与已通过的验收）
- [ ] 根 README 的 chat-toc 一节与一览表那一行留给发布提交一起进 main
