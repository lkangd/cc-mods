# 22: 大文件分块与增量读取

**What to build:** transcript 超过 4 MiB 也能完整读出目录，会话继续时只读新增部分、只重组末组；文件读不了或有认不出的行时，Pane 如实说明，不拼凑一份冒充完整的目录。

规格见 [chat-toc MVP](../spec.md) §3。

**Blocked by:** 17（自动停靠的最小目录）

**Status:** resolved

- [x] 首次读且 >4 MiB，或任何增量读取，在 macOS/Linux 用 `dd` 定位加 `head` 从字节偏移读 4,000,000 B；Windows 构造 Windows PowerShell 5.1 `[IO.File]` 按偏移读、base64 输出的命令
- [x] 每块截到最后一个换行，偏移加保留部分的 UTF-8 字节数；半行跨块边界时结果与整份读取一致（CT-DATA-004）
- [x] 单行超过一块时按「无法识别的行」计数并跳过
- [x] 文件变小时整份重读；新叶子能回溯到旧链末行时保留旧链、只从末组开组行起重组，否则整份重组；增量结果与整份重组逐组一致
- [x] 读失败或无权限时不显示任何条目，底部常驻原因，不用 `$.session.messages()` 拼凑（CT-DATA-002）
- [x] 无法识别的行跳过，底部说明「有 N 行无法识别，目录可能不完整」，N 为实际计数（CT-DATA-003）
- [x] 自动化测试覆盖分块边界、半行、超长行、增量与整份一致；Linux 与 Windows 只用 `$.process.run` 替身核对命令构造与输出解析

## Comments

**2026-10-10 实现说明（分支 `chat-toc/22-chunked-read`）**

- 模块：`source.ts` 是纯的分块读取（`readChunks` 按块循环、每块截到最后一个换行、偏移加保留部分的 UTF-8 字节数；`chunkCommand`/`chunkText` 构造 `sh -c 'dd … ; head -c …'` 或 Windows PowerShell 5.1 命令并解析输出）；`regroup.ts` 是增量模型（`readLines` 把新的整行并入索引，新叶子回溯碰到旧链末行就保留旧链、只从末组开组行起用 `groupTurns` 重组，否则整份重组）；`chain.ts` 拆成可增长的 `ChainIndex` + `walkBack`，`currentChain` 行为不变。`model.ts` 的 `tocModel` 不再被 register 使用，保留为测试里的「整份重组」判据。`register.tsx` 只多了 `runChunk`（唯一调 `$.process.run` 的地方）和读取状态。
- 增量与整份一致：测试只拿 `tocModel(整份文本)` 作判据，不写开组规则，所以 19 改规则后仍然有效。前提是开组只看行本身、一组的内容只取决于它从开组行到下一个开组行之间的行；19 若引入跨组的上下文，这组随机测试会失败。同一 uuid 被再次写入时整份重组。
- 起点：首次读（或文件变小、读失败后重来）且 ≤4 MiB 时用 `$.fs.read`，`fs.read` 失败就改走分块（文件在 stat 之后长过 4 MiB 的情形）；其余一律从偏移分块。半写的末行留到下一次读。
- 超长行：整块没有换行且文件在该处有满一块时，进入「跳过」状态，按字节前进到这一行结束才计 1 行无法识别；这一行还在写时跨多次读保持跳过状态，不重复计数。按块推进时，块尾被截断的多字节字符（宿主解码成 U+FFFD 或丢掉）不计入偏移，下一块从它的首字节重读。
- **Windows 块大小偏离**：Windows 每块读 3,000,000 B，不是 4,000,000 B。base64 让输出变大 4/3，`$.process.run` 只保留 stdout 的前 4 MiB（4,194,304 B），4,000,000 B 的 base64 是 5,333,336 B 会被截断；3,000,000 B 的 base64 正好 4,000,000 B。路径、偏移、字节数经环境变量 `CHAT_TOC_PATH/OFFSET/BYTES` 传入，不进脚本，免去 PowerShell 引号转义；文件以 `FileShare.ReadWrite` 打开。是否 Windows 按 transcript 路径判断（盘符或 UNC）。只有替身测试，未在真实 Windows 上跑。
- 失败（CT-DATA-002）：stat/读/命令失败时清空条目，Pane 末行常驻「没有权限读本会话的 transcript，目录无法显示」（EACCES/EPERM/permission/UnauthorizedAccess）或「读不到本会话的 transcript，目录无法显示」；下一次读从头重来。没有条目时这一行就是正文唯一的一行（画在最上面，不额外垫空行）。不调用 `$.session.messages()`。
- 无法识别（CT-DATA-003）：条目之后常驻一行「有 N 行无法识别，目录可能不完整」，N 累计解析失败的行与超长行，增量读取不重复计数。原来的「transcript 超过 4 MiB，目录暂时读不了」已删除。
- 测试：`claude plugin test mods/chat-toc` 52 项全过（2.1.295）；新增 `chunked_read`（逐个块大小、半行、半字符、超长行含仍在写的情形）、`incremental_regroup`（追加、rewind 新分支、侧链与坏行、同 uuid 重写、40 组随机会话随机切片对比整份）、`transcript_source`（>4 MiB 的 `dd`/`head` 命令与偏移、追加只从偏移读、半写末行、文件变小重读、无权限、读失败后恢复、坏行计数在底部、超长行、Windows PowerShell 命令与 base64 解析）。`tsc` 对 2.1.287 与 2.1.295 声明 0 错误；两版 `claude plugin validate` 通过（`$.process.run (via runChunk)`）。
- PTY（cmux 自开 workspace，关掉其他插件，合成 9.9 MB transcript：60 组、2 行坏行、1 行 4.1 MB 的非链行，`--resume`，事后删除）：
  - 2.1.295：`/chat-toc` 打开后 C000–C059 全部列出（滚到顶与底确认），末行「有 3 行无法识别，目录可能不完整」；之后一轮真实对话追加的行经增量读取后条目与计数不变（没有重复计数）。
  - 2.1.287：同一会话 resume，分块读取结果相同；把文件 `chmod 000` 后热重载，Pane 只剩「没有权限读本会话的 transcript，目录无法显示」；恢复权限再热重载，条目回来。
  - 终端只有 113 列，未自动停靠，用 `/chat-toc` 打开（请求时 ≥110 列可停靠）。
  - 没有在真实宿主里看到「增量读取后出现新的一组」：需要提交一条 human prompt，而这个合成会话的上下文有 973k token，一次 `!echo` 就让宿主发起了一轮模型调用（约 $0.96，5 小时额度用到 97%），没有再提交。这一点由 `transcript_source` 的追加测试覆盖。
