#!/usr/bin/env python3
"""Synthetic Claude Code transcripts for chat-toc acceptance. No real session
content: every prompt and reply is made up here, and uuids come from a seeded
generator, so the same arguments give the same bytes.

    transcript_fixture.py <kind> --config <CLAUDE_CONFIG_DIR> --cwd <project> --session <uuid> [--turns N] [--mib M]

writes <config>/projects/<cwd with non-alphanumerics as '-'>/<session>.jsonl,
where `claude --resume <session>` started in <cwd> finds it, and prints a JSON
record: path, turns, rows, bytes and the groups the generator meant to write.

Kinds:
  forms   every row shape the Turn group rules name, once or more: prompts
          (typed, queued, multi-line CJK and emoji, pasted content, image only,
          no timestamp, three identical), a prompt-type slash command, local
          commands as user rows and as system/local_command rows, !cmd, a
          subagent call, an interrupted turn, an API error, a reply with no
          text, reminders and task notifications, a compact boundary and a
          rewound branch left in the file.
  turns   N plain turns (1-3 tool calls and a 4-line reply), every 20th a
          system-row local command, every 25th a !cmd.
  many    turns of about 5 KB until M MiB (20 MiB is about 4400 turns).
  heavy   turns of 14 tool calls with 2-60 KB results until M MiB (20 MiB is
          about 110 turns).
"""
import argparse
import datetime
import json
import pathlib
import random
import re
import uuid

T0 = datetime.datetime(2026, 10, 9, 1, 0, 0, tzinfo=datetime.timezone.utc)


def project_dir(config: pathlib.Path, cwd: str) -> pathlib.Path:
    return pathlib.Path(config) / "projects" / re.sub(r"[^A-Za-z0-9]", "-", cwd)


class Transcript:
    """Rows on one conversation chain, written as the host writes them."""

    def __init__(self, path: pathlib.Path, cwd: str, session: str, seed: int = 0, version: str = "2.1.287") -> None:
        self.path = path
        self.cwd = cwd
        self.session = session
        self.version = version
        self.random = random.Random(seed)
        self.parent: str | None = None
        self.tick = 0
        self.rows = 0
        self.bytes = 0
        self.groups: list[dict] = []       # what the generator meant: one per opened group
        self.sub_rows: dict[str, list[dict]] = {}
        self.order: dict[str, int] = {}
        path.parent.mkdir(parents=True, exist_ok=True)
        self.out = open(path, "w", encoding="utf-8")

    # ---------- plumbing ----------
    def uid(self) -> str:
        return str(uuid.UUID(int=self.random.getrandbits(128), version=4))

    def hexid(self, n: int = 20) -> str:
        return "%0*x" % (n, self.random.getrandbits(4 * n))

    def emit(self, row: dict) -> None:
        self.order[row["uuid"]] = len(self.order)
        line = json.dumps(row, ensure_ascii=False) + "\n"
        self.out.write(line)
        self.rows += 1
        self.bytes += len(line.encode())

    def base(self, kind: str, timestamp: bool = True, parent="chain") -> dict:
        self.tick += 1
        row = {"parentUuid": self.parent if parent == "chain" else parent, "isSidechain": False, "type": kind,
               "uuid": self.uid(), "userType": "external", "entrypoint": "cli", "cwd": self.cwd,
               "sessionId": self.session, "version": self.version, "gitBranch": "main"}
        if timestamp:
            row["timestamp"] = (T0 + datetime.timedelta(seconds=self.tick * 7)).isoformat().replace("+00:00", "Z")
        self.parent = row["uuid"]
        return row

    def user(self, content, **fields) -> dict:
        row = self.base("user", timestamp=fields.pop("timestamp", True))
        row["message"] = {"role": "user", "content": content}
        row.update(fields)
        self.emit(row)
        return row

    def assistant(self, content, stop="end_turn", mid=None, **fields) -> dict:
        row = self.base("assistant")
        row["requestId"] = "req_" + self.hexid()
        row["message"] = {"model": "claude-haiku-4-5", "id": mid or "msg_" + self.hexid(), "type": "message",
                          "role": "assistant", "content": content, "stop_reason": stop, "stop_sequence": None,
                          "usage": {"input_tokens": 10, "output_tokens": 20, "cache_read_input_tokens": 0,
                                    "cache_creation_input_tokens": 0}}
        row.update(fields)
        self.emit(row)
        return row

    def system(self, subtype: str, content: str, parent="chain", **fields) -> dict:
        row = self.base("system", parent=parent)
        row.update({"subtype": subtype, "content": content, "level": "info", "isMeta": False}, **fields)
        self.emit(row)
        return row

    def meant(self, user: str, steps: int = 0, at: str = "") -> None:
        self.groups.append({"user": user, "steps": steps, "row": at})

    # ---------- shapes ----------
    def prompt(self, text, source="typed", timestamp=True) -> dict:
        row = self.user(text, timestamp=timestamp, promptId=self.uid(), permissionMode="default",
                        origin={"kind": "human"}, promptSource=source)
        shown = text if isinstance(text, str) else " ".join(b.get("text", "") for b in text if b.get("type") == "text")
        self.meant(re.sub(r"\s+", " ", shown).strip(), at=row["uuid"])
        return row

    def tool(self, label: str, result_len: int = 40, name: str = "Bash") -> dict:
        tid = "toolu_" + self.hexid()
        call = self.assistant([{"type": "tool_use", "id": tid, "name": name,
                                "input": {"command": f"echo {label}", "description": "Print"}}], stop="tool_use")
        body = (f"{label} " * (result_len // (len(label) + 1) + 1))[:result_len]
        result = self.user([{"type": "tool_result", "content": body, "tool_use_id": tid, "is_error": False}],
                           sourceToolAssistantUUID=call["uuid"])
        self.groups[-1]["steps"] += 1
        return result

    def reply(self, text: str, mid=None) -> dict:
        return self.assistant([{"type": "text", "text": text}], mid=mid)

    def slash_prompt(self, name: str, args: str) -> None:
        row = self.user(f"<command-message>{name}</command-message>\n<command-name>/{name}</command-name>\n"
                        f"<command-args>{args}</command-args>", origin={"kind": "human"})
        self.meant(f"/{name} {args}".strip(), at=row["uuid"])

    def local_command_user_row(self, name: str, args: str, stdout: str) -> None:
        self.user("<local-command-caveat>Caveat: The messages below were generated by the user while running "
                  "local commands.</local-command-caveat>", isMeta=True)
        row = self.user(f"<command-name>/{name}</command-name>\n<command-message>{name}</command-message>\n"
                        f"<command-args>{args}</command-args>")
        self.user(f"<local-command-stdout>{stdout}</local-command-stdout>")
        self.meant(f"/{name} {args}".strip(), at=row["uuid"])

    def local_command_system_row(self, name: str, args: str, stdout: str) -> None:
        row = self.system("local_command", f"<command-name>/{name}</command-name>\n"
                          f"            <command-message>{name}</command-message>\n"
                          f"            <command-args>{args}</command-args>")
        self.system("local_command", f"<local-command-stdout>{stdout}</local-command-stdout>")
        self.meant(f"/{name} {args}".strip(), at=row["uuid"])

    def bang(self, command: str, stdout: str) -> None:
        row = self.user(f"<bash-input>{command}</bash-input>")
        self.user(f"<bash-stdout>{stdout}</bash-stdout><bash-stderr></bash-stderr>")
        self.meant(f"!{command}", at=row["uuid"])

    def subagent(self, label: str) -> None:
        """An Agent call: one step here, its own rows in a file of its own."""
        agent = "a" + self.hexid(16)
        self.tool(label, name="Agent")
        side, parent = [], None
        for k, (kind, content) in enumerate((("user", f"{label} 子任务说明"),
                                             ("assistant", [{"type": "text", "text": f"{label} 子 agent 的报告"}]))):
            row = {"parentUuid": parent, "isSidechain": True, "agentId": agent, "type": kind, "uuid": self.uid(),
                   "timestamp": (T0 + datetime.timedelta(seconds=self.tick * 7 + k)).isoformat().replace("+00:00", "Z"),
                   "sessionId": self.session, "cwd": self.cwd, "version": self.version,
                   "message": {"role": kind, "content": content}}
            parent = row["uuid"]
            side.append(row)
        self.sub_rows[agent] = side

    def interrupt(self, for_tool: bool = True) -> None:
        self.user([{"type": "text", "text": "[Request interrupted by user for tool use]" if for_tool
                    else "[Request interrupted by user]"}])

    def api_error(self) -> None:
        row = self.assistant([{"type": "text", "text": "API Error: Repeated 529 Overloaded errors"}],
                             isApiErrorMessage=True, error="overloaded")
        row["message"]["model"] = "<synthetic>"

    def reminder(self, text: str) -> None:
        self.user(text, isMeta=True)

    def task_notification(self, label: str) -> None:
        self.user(f"<task-notification><task-id>{self.hexid(8)}</task-id><status>completed</status>"
                  f"<summary>{label} 后台任务完成</summary></task-notification>")

    def compact(self) -> None:
        leaf = self.parent
        self.system("compact_boundary", "Conversation compacted", parent=None, logicalParentUuid=leaf,
                    compactMetadata={"trigger": "manual", "preTokens": 1000})
        self.user("This session is being continued from a previous conversation. 合成摘要。",
                  isCompactSummary=True, isVisibleInTranscriptOnly=True)

    def rewind_to(self, row: dict) -> None:
        """The next row hangs off `row`; groups opened after it are abandoned."""
        self.parent = row["uuid"]
        self.groups = [g for g in self.groups if self.order[g["row"]] <= self.order[row["uuid"]]]

    # ---------- finishing ----------
    def close(self) -> dict:
        self.out.close()
        for agent, rows in self.sub_rows.items():
            folder = self.path.parent / self.path.stem / "subagents"
            folder.mkdir(parents=True, exist_ok=True)
            with open(folder / f"agent-{agent}.jsonl", "w", encoding="utf-8") as handle:
                for row in rows:
                    handle.write(json.dumps(row, ensure_ascii=False) + "\n")
        return {"path": str(self.path), "rows": self.rows, "bytes": self.bytes,
                "groups": [{"user": g["user"], "steps": g["steps"]} for g in self.groups]}


def _turn(t: Transcript, i: int, tools: int, result_len=lambda: 40, attachments: int = 0) -> None:
    t.prompt(f"T{i:04d} 用户问题：请检查第 {i} 个模块的状态，\n并说明下一步该做什么。")
    for s in range(tools):
        t.tool(f"module-{i}-{s}", result_len())
        for _ in range(attachments):
            row = t.base("attachment")
            row["attachment"] = {"type": "nested_memory", "content": "x" * t.random.randint(300, 1500)}
            t.emit(row)
    body = "\n".join(f"第 {j} 行说明：模块 {i} 的检查结果正常，没有发现需要处理的问题。" for j in range(1, 5))
    t.reply(f"T{i:04d} 回复：\n{body}")


def _plain(t: Transcript, i: int) -> None:
    if i % 20 == 7:
        t.local_command_system_row("tui", "", f"T{i:04d} Current renderer: fullscreen")
    elif i % 25 == 12:
        t.bang(f"echo T{i:04d}", f"T{i:04d}")
    else:
        _turn(t, i, 1 + i % 3)


def _forms(t: Transcript) -> dict:
    t.prompt("F01 普通 prompt：请列出模块。")
    t.tool("f01")
    t.reply("F01 回复：共有三个模块。")
    t.prompt("F02 多行与宽字符：第一行中文\n第二行 emoji 🚀✨ 与全角，ＡＢＣ\n第三行很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长")
    t.reply("F02 回复：收到多行输入。")
    t.prompt("F03 粘贴：<pasted_content id=\"1\">贴进来的一段文字</pasted_content> 结束")
    t.groups[-1]["user"] = "F03 粘贴： 贴进来的一段文字 结束"
    t.reply("F03 回复：看到了粘贴的内容。")
    t.prompt([{"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "iVBORw0KGgo="}}])
    t.groups[-1]["user"] = "（只有图片）"
    t.reply("F04 回复：这是一张图片。")
    t.prompt("F05 没有时间戳的 prompt", timestamp=False)
    t.reply("F05 回复：好。")
    repeated = "F06 完全相同的 prompt"
    for _ in range(3):
        t.prompt(repeated)
        t.reply("F06 回复：同一句话的又一次回答。")
    t.slash_prompt("review", "F07 main")
    t.tool("f07")
    t.reply("F07 回复：审查完成。")
    t.local_command_user_row("model", "F08", "Set model to haiku")
    t.local_command_system_row("tui", "F09", "Current renderer: fullscreen")
    t.bang("echo F10", "F10")
    t.prompt("F11 派一个子 agent 去查")
    subagent = t.groups[-1]["user"]
    t.subagent("f11")
    t.reply("F11 回复：子 agent 查完了。")
    t.prompt("F12 会被打断的 prompt")
    t.tool("f12")
    t.interrupt()
    t.prompt("F13 会出错的 prompt")
    t.tool("f13")
    t.api_error()
    t.prompt("F14 只有工具没有文字回复")
    t.tool("f14a")
    t.tool("f14b")
    t.prompt("F15 排队提交的 prompt", source="queued")
    t.reminder("<system-reminder>合成提醒</system-reminder>")
    t.reply("F15 回复：处理了排队的提交。")
    t.task_notification("F15")
    t.reply("F15 回复：后台任务也完成了。")
    t.prompt("F16 压缩之前的最后一轮")
    t.reply("F16 回复：压缩前。")
    t.compact()
    t.prompt("F17 压缩之后的第一轮")
    branch = t.reply("F17 回复：压缩后。")
    abandoned = "F18 将被 rewind 抛弃的 prompt"
    t.prompt(abandoned)
    t.reply("F18 回复：这一支会被抛弃。")
    t.rewind_to(branch)
    t.prompt("F19 rewind 之后的新分支")
    t.reply("F19 回复：新分支。")
    return {"repeated": repeated, "subagent": subagent, "abandoned": abandoned}


def generate(kind: str, config: pathlib.Path, cwd: str, session: str, *, turns: int = 300, mib: float = 20,
             seed: int = 12, version: str = "2.1.287") -> dict:
    path = project_dir(config, cwd) / f"{session}.jsonl"
    t = Transcript(path, cwd, session, seed=seed, version=version)
    extra: dict = {}
    if kind == "forms":
        extra = _forms(t)
        count = len(t.groups)
    elif kind == "turns":
        for i in range(turns):
            _plain(t, i)
        count = turns
    elif kind in ("many", "heavy"):
        target, i = mib * 1048576, 0
        while t.bytes < target:
            if kind == "many":
                _plain(t, i)
            else:
                # 10 small, 3 medium and 1 large result a turn, in shuffled order,
                # so every turn weighs about the same 190 KB
                sizes = [2000] * 10 + [12000] * 3 + [60000]
                t.random.shuffle(sizes)
                _turn(t, i, 14, iter(sizes).__next__, attachments=3)
            i += 1
        count = i
    else:
        raise ValueError(f"unknown fixture kind {kind!r}")
    out = t.close()
    out.update(extra, kind=kind, turns=count, session=session, cwd=cwd)
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("kind", choices=["forms", "turns", "many", "heavy"])
    parser.add_argument("--config", required=True, type=pathlib.Path, help="the CLAUDE_CONFIG_DIR the host will read")
    parser.add_argument("--cwd", required=True, help="the project directory the host will be started in")
    parser.add_argument("--session", required=True)
    parser.add_argument("--turns", type=int, default=300)
    parser.add_argument("--mib", type=float, default=20)
    parser.add_argument("--seed", type=int, default=12)
    parser.add_argument("--version", default="2.1.287")
    a = parser.parse_args()
    out = generate(a.kind, a.config, a.cwd, a.session, turns=a.turns, mib=a.mib, seed=a.seed, version=a.version)
    out["groups"] = len(out["groups"])
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
