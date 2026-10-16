"""The verifier's expectations, from hand-written transcript rows.

Every expected value here is written out from the spec's rules (§3 对话链,
§4 Turn group), not computed the way the verifier computes it."""
import datetime
import json
import pathlib
import tempfile
import unittest

import toc_verifier

CST = datetime.timezone(datetime.timedelta(hours=8))
NOW = datetime.datetime(2026, 10, 10, 12, 0, tzinfo=CST)


class Rows:
    """A chain of rows, each parented on the one before unless told otherwise."""

    def __init__(self) -> None:
        self.rows: list[dict] = []
        self.parent: str | None = None
        self.n = 0

    def _row(self, kind: str, parent="chain", **fields) -> dict:
        self.n += 1
        row = {
            "parentUuid": self.parent if parent == "chain" else parent,
            "isSidechain": False,
            "type": kind,
            "uuid": f"u{self.n:03d}",
            "timestamp": f"2026-10-09T01:{self.n:02d}:00.000Z",
            "sessionId": "s",
        }
        row.update(fields)
        self.rows.append(row)
        self.parent = row["uuid"]
        return row

    def prompt(self, text, **fields) -> dict:
        fields.setdefault("origin", {"kind": "human"})
        fields.setdefault("promptSource", "typed")
        return self._row("user", message={"role": "user", "content": text}, **fields)

    def user(self, content, **fields) -> dict:
        return self._row("user", message={"role": "user", "content": content}, **fields)

    def tool(self, name="Bash", mid=None) -> dict:
        self.n += 0
        tid = f"toolu_{self.n + 1:03d}"
        row = self._row("assistant", message={"id": mid or f"msg_{self.n + 1}", "role": "assistant",
                                              "content": [{"type": "tool_use", "id": tid, "name": name, "input": {}}]})
        self.user([{"type": "tool_result", "tool_use_id": tid, "content": "ok"}])
        return row

    def text(self, text, mid=None, **fields) -> dict:
        return self._row("assistant", message={"id": mid or f"msg_{self.n + 1}", "role": "assistant",
                                               "content": [{"type": "text", "text": text}]}, **fields)

    def system(self, subtype, content="", parent="chain", **fields) -> dict:
        return self._row("system", parent=parent, subtype=subtype, content=content, **fields)

    def write(self, extra_lines=()) -> pathlib.Path:
        folder = pathlib.Path(tempfile.mkdtemp())
        path = folder / "t.jsonl"
        lines = [json.dumps(r, ensure_ascii=False) for r in self.rows] + list(extra_lines)
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return path


def expect(rows: Rows, extra_lines=()):
    return toc_verifier.expected_toc(rows.write(extra_lines), tz=CST, now=NOW)


class TurnGroups(unittest.TestCase):
    def test_a_prompt_with_tools_and_a_reply_is_one_group(self):
        t = Rows()
        t.prompt("检查模块")
        t.tool()
        t.tool()
        t.text("模块正常。")
        toc = expect(t)
        self.assertEqual(len(toc.groups), 1)
        g = toc.groups[0]
        self.assertEqual(g.key, "u001")
        self.assertEqual(g.user_text, "检查模块")
        self.assertEqual(g.time, "10月9日 09:01")
        self.assertEqual(g.steps, 2)
        self.assertEqual(g.last_text, "模块正常。")
        self.assertEqual(g.agent_head, "2 步")
        self.assertTrue(g.has_agent)

    def test_time_from_another_year_carries_the_year_and_a_missing_one_is_none(self):
        t = Rows()
        t.prompt("旧的", timestamp="2025-03-01T00:05:00.000Z")
        t.text("好")
        t.prompt("没有时间")
        del t.rows[-1]["timestamp"]
        t.text("好")
        groups = expect(t).groups
        self.assertEqual(groups[0].time, "2025年3月1日 08:05")
        self.assertIsNone(groups[1].time)

    def test_rows_that_open_a_group(self):
        t = Rows()
        t.prompt("普通")
        t.text("a")
        t.prompt("排队的", promptSource="queued")
        t.prompt("建议的", promptSource="suggestion_accepted")
        # prompt-type slash command: a user row with origin human
        t.user("<command-message>review</command-message>\n<command-name>/review</command-name>\n"
               "<command-args>main</command-args>", origin={"kind": "human"})
        t.text("b")
        # local command written as a user row, origin null, with its output
        t.user("<command-name>/clear</command-name>\n<command-message>clear</command-message>\n<command-args></command-args>")
        t.user("<local-command-stdout></local-command-stdout>")
        # local command written as system/local_command rows
        t.system("local_command", "<command-name>/tui</command-name>\n<command-message>tui</command-message>\n<command-args>fullscreen</command-args>")
        t.system("local_command", "<local-command-stdout>ok</local-command-stdout>")
        t.user("<bash-input>ls -la</bash-input>")
        t.user("<bash-stdout>a</bash-stdout><bash-stderr></bash-stderr>")
        texts = [g.user_text for g in expect(t).groups]
        self.assertEqual(texts, ["普通", "排队的", "建议的", "/review main", "/clear", "/tui fullscreen", "!ls -la"])

    def test_rows_that_do_not_open_a_group(self):
        t = Rows()
        t.prompt("唯一")
        t.user("<task-notification>done</task-notification>")
        t.user("<local-command-caveat>Caveat</local-command-caveat>", isMeta=True)
        t.user("<local-command-stdout>x</local-command-stdout>")
        t.user("<bash-stdout>x</bash-stdout>")
        t.user("提醒", isMeta=True, origin={"kind": "human"})
        t.user("摘要", isCompactSummary=True, origin={"kind": "human"})
        t.user("来自子 agent", isMeta=True, origin={"kind": "peer"})
        t.user("sdk", promptSource="sdk")
        t.user([{"type": "tool_result", "tool_use_id": "x", "content": "r"}], origin={"kind": "human"})
        t.user([{"type": "text", "text": "[Request interrupted by user]"}])
        t.system("local_command", "<local-command-stdout>no name</local-command-stdout>")
        t.system("stop_hook_summary")
        self.assertEqual([g.user_text for g in expect(t).groups], ["唯一"])

    def test_identical_prompts_are_separate_groups(self):
        t = Rows()
        for _ in range(3):
            t.prompt("同一句话")
            t.text("好")
        self.assertEqual([g.user_text for g in expect(t).groups], ["同一句话"] * 3)

    def test_user_text_is_cleaned(self):
        t = Rows()
        t.prompt("# 标题\n\n看看 **这里** 和 `x`\n```py\nprint(1)\n```\n<pasted_content id=1>贴的</pasted_content>  结尾")
        t.text("好")
        t.prompt([{"type": "image", "source": {}}])
        t.text("好")
        t.prompt([{"type": "text", "text": "图 ![a](b.png) 在此"}, {"type": "image", "source": {}}])
        t.text("好")
        texts = [g.user_text for g in expect(t).groups]
        self.assertEqual(texts, ["标题 看看 这里 和 x 贴的 结尾", "（只有图片）", "图 在此"])


class UserTextEdgeCases(unittest.TestCase):
    # ticket 19's reading of "leave out code blocks, images and Markdown marks"
    def test_image_placeholders_go_and_a_code_only_prompt_shows_its_code(self):
        t = Rows()
        t.prompt("看 [Image #1] 这张图")
        t.text("好")
        t.prompt("```\nnpm run build\n```")
        t.text("好")
        self.assertEqual([g.user_text for g in expect(t).groups], ["看 这张图", "npm run build"])


class AgentSide(unittest.TestCase):
    def test_last_text_is_after_the_last_tool_and_joins_blocks_of_one_message(self):
        t = Rows()
        t.prompt("p")
        t.text("先说一句")
        t.tool()
        t.text("第一段", mid="m9")
        t.text("第二段", mid="m9")
        g = expect(t).groups[0]
        self.assertEqual(g.steps, 1)
        self.assertEqual(g.last_text, "第一段 第二段")

    def test_last_text_is_only_the_last_message_after_the_last_tool(self):
        t = Rows()
        t.prompt("p")
        t.tool()
        t.text("早的", mid="m1")
        t.text("晚的", mid="m2")
        self.assertEqual(expect(t).groups[0].last_text, "晚的")

    def test_no_text_after_the_last_tool(self):
        t = Rows()
        t.prompt("p")
        t.text("开始前说的")
        t.tool()
        t.tool()
        g = expect(t).groups[0]
        self.assertIsNone(g.last_text)
        self.assertEqual(g.agent_head, "2 步 · 无文字回复")

    def test_parallel_tools_count_each_and_an_agent_call_counts_one(self):
        t = Rows()
        t.prompt("p")
        t._row("assistant", message={"id": "m", "role": "assistant", "content": [
            {"type": "thinking", "thinking": "..."},
            {"type": "tool_use", "id": "a", "name": "Read", "input": {}},
            {"type": "tool_use", "id": "b", "name": "Read", "input": {}},
            {"type": "tool_use", "id": "c", "name": "Agent", "input": {}},
        ]})
        t.text("完")
        self.assertEqual(expect(t).groups[0].steps, 3)

    def test_sidechain_rows_never_count(self):
        t = Rows()
        t.prompt("p")
        t.tool(name="Agent")
        side = t.text("子 agent 的话", isSidechain=True)
        t.parent = side["parentUuid"]
        t.text("完")
        g = expect(t).groups[0]
        self.assertEqual((g.steps, g.last_text), (1, "完"))

    def test_interrupted_and_error_and_user_only(self):
        t = Rows()
        t.prompt("被打断")
        t.tool()
        t.user([{"type": "text", "text": "[Request interrupted by user for tool use]"}])
        t.prompt("出错")
        t.tool()
        t.text("API Error: overloaded", isApiErrorMessage=True)
        t.prompt("错后恢复")
        t.text("API Error", isApiErrorMessage=True)
        t.text("恢复了")
        t.prompt("打断在任何输出之前")
        t.user([{"type": "text", "text": "[Request interrupted by user]"}])
        t.user("<bash-input>pwd</bash-input>")
        t.user("<bash-stdout>/</bash-stdout><bash-stderr></bash-stderr>")
        t.system("local_command", "<command-name>/model</command-name>\n<command-args></command-args>")
        t.prompt("没有回复")
        heads = [(g.user_text, g.agent_head if g.has_agent else None) for g in expect(t).groups]
        self.assertEqual(heads, [
            ("被打断", "已中断 · 1 步"),
            ("出错", "出错 · 1 步"),
            ("错后恢复", ""),
            ("打断在任何输出之前", "已中断"),
            ("!pwd", None),
            ("/model", None),
            # ticket 19: no assistant row and no interruption yet draws no Agent side
            ("没有回复", None),
        ])

    def test_an_api_error_text_is_the_last_text_of_its_group(self):
        # spec §4: the last text is the text after the last tool_use; the error row's text is one
        t = Rows()
        t.prompt("出错")
        t.tool()
        t.text("API Error: overloaded", isApiErrorMessage=True)
        g = expect(t).groups[0]
        self.assertEqual((g.agent_head, g.last_text), ("出错 · 1 步", "API Error: overloaded"))


class ConversationChain(unittest.TestCase):
    def test_rewind_drops_the_abandoned_branch(self):
        t = Rows()
        t.prompt("一")
        a = t.text("一的回复")
        t.prompt("被弃")
        t.text("被弃的回复")
        t.parent = a["uuid"]
        t.prompt("新分支")
        t.text("新的回复")
        self.assertEqual([g.user_text for g in expect(t).groups], ["一", "新分支"])

    def test_compact_boundary_follows_the_logical_parent(self):
        t = Rows()
        t.prompt("压缩前")
        before = t.text("前")
        t.system("compact_boundary", "Conversation compacted", parent=None, logicalParentUuid=before["uuid"])
        t.user("摘要", isCompactSummary=True, isVisibleInTranscriptOnly=True)
        t.prompt("压缩后")
        t.text("后")
        self.assertEqual([g.user_text for g in expect(t).groups], ["压缩前", "压缩后"])

    def test_leaf_is_the_last_row_and_metadata_rows_are_ignored(self):
        t = Rows()
        t.prompt("一")
        t.text("好")
        extra = [json.dumps({"type": "last-prompt", "lastPrompt": "x"}),
                 json.dumps({"type": "file-history-snapshot", "messageId": "m"})]
        self.assertEqual([g.user_text for g in expect(t, extra).groups], ["一"])

    def test_unreadable_lines_are_counted_and_skipped(self):
        t = Rows()
        t.prompt("一")
        t.text("好")
        toc = expect(t, ["{not json", "[1, 2]"])
        self.assertEqual(toc.unreadable, 2)
        self.assertEqual(len(toc.groups), 1)

    def test_a_missing_file_is_an_empty_toc(self):
        toc = toc_verifier.expected_toc(pathlib.Path(tempfile.mkdtemp()) / "none.jsonl", tz=CST, now=NOW)
        self.assertEqual((toc.exists, toc.groups), (False, []))


def boundary(t: Rows, trigger: str, logical=None) -> dict:
    row = t.system("compact_boundary", "Conversation compacted", parent=None,
                   logicalParentUuid=logical or t.parent, compactMetadata={"trigger": trigger})
    t.user("摘要", isCompactSummary=True, isVisibleInTranscriptOnly=True)
    return row


class Compactions(unittest.TestCase):
    """Where each compaction's rule goes (spec 0.2 §5), written out by hand."""

    def test_the_four_places(self):
        t = Rows()
        t.prompt("零")
        t.text("零的回复")
        boundary(t, "manual")                                   # 09:03, before the /compact row
        t.user("<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args></command-args>")
        t.prompt("提交时压缩")
        boundary(t, "auto")                                     # 09:07, at a submit
        t.text("压缩后回复")
        t.prompt("轮中压缩")
        t.tool()
        boundary(t, "auto")                                     # 09:13, mid-turn
        t.text("继续")
        t.prompt("下一轮")
        toc = expect(t)
        self.assertEqual([g.user_text for g in toc.groups], ["零", "/compact", "提交时压缩", "轮中压缩", "下一轮"])
        self.assertEqual([(c.trigger, c.clock, c.before) for c in toc.compactions],
                         [("manual", "09:03", 2), ("auto", "09:07", 2), ("auto", "09:13", 4)])
        self.assertFalse(toc.earlier_elsewhere)
        self.assertEqual(toc_verifier.expected_rules(toc), [{"before": 2, "text": "自动压缩 ×2 · 09:07"},
                                                            {"before": 4, "text": "自动压缩 09:13"}])
        self.assertEqual(toc_verifier.expected_rules(toc, "agent"), [{"before": 1, "text": "自动压缩 ×2 · 09:07"},
                                                                     {"before": 3, "text": "自动压缩 09:13"}])

    def test_a_file_starting_at_a_foreign_boundary_has_earlier_turns_elsewhere(self):
        t = Rows()
        boundary(t, "manual", logical="not-in-this-file")
        t.prompt("分叉后")
        t.text("回复")
        toc = expect(t)
        self.assertTrue(toc.earlier_elsewhere)
        self.assertEqual([c.before for c in toc.compactions], [0])

    def test_under_a_query_the_rules_go_between_the_matches(self):
        t = Rows()
        for n in range(4):
            t.prompt(f"问题 {n}")
            t.text(f"回复 {n}")
            if n in (0, 1):
                boundary(t, "auto")
        toc = expect(t)
        self.assertEqual([c.before for c in toc.compactions], [1, 2])
        self.assertEqual(toc_verifier.expected_rules(toc, "all", among=[0, 3]),
                         [{"before": 1, "text": toc_verifier.rule_label("auto", 2, toc.compactions[-1].clock)}])

    def test_reads_rules_and_the_fork_line_from_a_window(self):
        rows = ["x" * 10 + "│1: 全部   2: 用户   3: Agent",
                "x" * 10 + "│━━━━━━━──────────────",
                "x" * 10 + "│更早的轮次不在本会话的文件里",
                "x" * 10 + "│╌ 已压缩 09:03 ╌╌╌╌╌╌╌╌╌╌",
                "x" * 10 + "│●  分叉后                09:05",
                "x" * 10 + "│├╴ 回复",
                "x" * 10 + "│╌ 自动压缩 09:09 ╌╌╌╌╌╌╌╌",
                "x" * 10 + "│",
                "x" * 10 + "│",
                "x" * 10 + "│──────────────────────────",
                "x" * 10 + "│1 轮            l: 布局 卡片"]
        pane = toc_verifier.parse_pane(rows)
        self.assertTrue(pane.fork_line)
        self.assertEqual(pane.rules, [{"text": "已压缩 09:03", "before": 0}, {"text": "自动压缩 09:09", "before": 1}])
        self.assertEqual(pane.notes, [])


    def test_reads_the_search_row_apart_from_the_notes(self):
        rows = ["x" * 10 + "│1: 全部   2: 用户   3: Agent",
                "x" * 10 + "│━━━━━━━──────────────",
                "x" * 10 + "│f: 搜索 登录 ⏎ 跳转    1 / 8 ✕ ‹ ›",
                "x" * 10 + "│●  修改登录页                09:05",
                "x" * 10 + "│├╴ 回复",
                "x" * 10 + "│──────────────────────────",
                "x" * 10 + "│1 轮            l: 布局 卡片"]
        pane = toc_verifier.parse_pane(rows)
        self.assertEqual(pane.search, {"text": "登录", "count": "1 / 8", "clear": True, "focused": True, "step": True})
        self.assertEqual([e.user_text for e in pane.entries], ["修改登录页"])
        self.assertEqual(pane.notes, [])
        self.assertEqual(toc_verifier.parse_search_row("f: 搜索 词或文件路径 ‹ ›"), {"text": "", "count": None, "clear": False, "focused": False, "step": True})
        self.assertEqual(toc_verifier.parse_search_row("f: Find nowhere   0 of 3 ✕ ‹ ›"), {"text": "nowhere", "count": "0 of 3", "clear": True, "focused": False, "step": True})
        # before 0.2's ‹ › (ticket 18)
        self.assertEqual(toc_verifier.parse_search_row("f: 搜索 词或文件路径"), {"text": "", "count": None, "clear": False, "focused": False, "step": False})
        self.assertIsNone(toc_verifier.parse_search_row("●  f: 搜索"))


TESTDATA = pathlib.Path(__file__).parent / "testdata"


def screen(name: str) -> list[str]:
    return (TESTDATA / name).read_text(encoding="utf-8").rstrip("\n").split("\n")


def forms_groups():
    import transcript_fixture
    out = transcript_fixture.generate("forms", pathlib.Path(tempfile.mkdtemp()), "/tmp/proj", "00000000-0000-4000-8000-0000000000f0")
    return toc_verifier.expected_toc(pathlib.Path(out["path"]), tz=CST, now=NOW).groups


SCREENS = [f"{view}-{host}.txt" for view in ("card", "compact", "timeline", "card-agent") for host in ("2.1.295", "2.1.287")]


class PaneScreen(unittest.TestCase):
    """Screens of the forms fixture resumed on each host, the Pane in each Layout
    (card-agent: the card under the Agent filter), 170 columns by 44 rows."""

    def test_reads_the_entries_of_a_card_window(self):
        pane = toc_verifier.parse_pane(screen("card-2.1.295.txt"))
        self.assertEqual((pane.left, pane.filter, pane.layout, pane.footer), (126, "all", "卡片", "20 轮"))
        self.assertEqual([e.user_text for e in pane.entries], [
            "/review F07 main", "/model F08", "/tui F09", "!echo F10", "F11 派一个子 agent 去查", "F12 会被打断的 prompt",
            "F13 会出错的 prompt", "F14 只有工具没有文字回复", "F15 排队提交的 prompt", "F16 压缩之前的最后一轮",
            "F17 压缩之后的第一轮", "F19 rewind 之后的新分支"])
        f13 = pane.entries[6]
        self.assertEqual((f13.time, f13.agent_head), ("09:04", "出错 · 1 步"))
        self.assertEqual(f13.agent_lines, ["API Error: Repeated 529", "Overloaded errors"])
        self.assertEqual(pane.entries[1].agent_head, None)                  # /model: no agent side
        self.assertEqual(pane.entries[8].agent_head, "")                    # F15: a reply, no steps
        self.assertEqual([e.highlighted for e in pane.entries], [False] * 11 + [True])
        self.assertEqual((pane.entries[0].user_row, pane.entries[0].agent_row), (4, 5))

    def test_reads_the_time_column_of_compact_and_timeline(self):
        compact = toc_verifier.parse_pane(screen("compact-2.1.295.txt"))
        self.assertEqual(compact.layout, "紧凑")
        self.assertEqual([(e.user_text, e.time) for e in compact.entries[:3]],
                         [("F03 粘贴： 贴进来的一段文字 结束", "09:00"), ("（只有图片）", "09:01"), ("F05 没有时间戳的 prompt", "")])
        timeline = toc_verifier.parse_pane(screen("timeline-2.1.295.txt"))
        self.assertEqual((timeline.layout, timeline.entries[0].time), ("时间轴", "09:02"))

    def test_reads_the_preview_apart_from_the_entries(self):
        pane = toc_verifier.parse_pane(screen("card-preview-2.1.295.txt"))
        self.assertEqual(pane.entries[-1].user_text, "F19 rewind 之后的新分支")
        self.assertEqual(len(pane.notes), 2)                                # the Minimap's two rows
        self.assertEqual((pane.layout, pane.footer), ("卡片", "20 轮"))
        self.assertEqual([r.strip() for r in pane.preview if r.strip()],
                         ["─ p: 预览 ──────────────────────────────────", "10月9日 09:07 · 输出 20", "用户",
                          "F19 rewind 之后的新分支", "Agent", "F19 回复：新分支。"])
        self.assertIsNone(toc_verifier.parse_pane(screen("card-2.1.295.txt")).preview)

    def test_reads_the_filter_from_the_tab_rule(self):
        pane = toc_verifier.parse_pane(screen("card-agent-2.1.295.txt"))
        self.assertEqual(pane.filter, "agent")
        self.assertTrue(all(not e.has_user and e.agent_head is not None for e in pane.entries))
        self.assertEqual(pane.entries[0].agent_lines, ["F02 回复：收到多行输入。"])

    def test_the_close_glyph_2_1_287_draws_on_the_filter_row_is_not_text(self):
        pane = toc_verifier.parse_pane(screen("card-2.1.287.txt"))
        self.assertEqual((pane.filter_row, pane.filter), (0, "all"))
        self.assertEqual(pane.entries[0].user_text, "/review F07 main")

    def test_reads_a_pane_without_its_filter_row(self):
        rows = screen("card-2.1.295.txt")
        rows[1] = rows[1][:126] + " " * 30                                   # the filter row, blanked
        pane = toc_verifier.parse_pane(rows)
        self.assertEqual(pane.entries[0].user_text, "/review F07 main")

    def test_no_pane_on_screen(self):
        self.assertIsNone(toc_verifier.find_pane(["❯ hello", "", "──────"]))

    def test_windows_that_match_the_transcript(self):
        for name in SCREENS:
            with self.subTest(name):
                diff = toc_verifier.compare_window(forms_groups(), toc_verifier.parse_pane(screen(name)))
                self.assertTrue(diff["ok"], json.dumps(diff, ensure_ascii=False, indent=1))

    def test_a_wrong_agent_side_is_named_entry_by_entry(self):
        rows = [r.replace("├╴ 已中断 · 1 步", "├╴ 1 步") for r in screen("card-2.1.295.txt")]
        diff = toc_verifier.compare_window(forms_groups(), toc_verifier.parse_pane(rows))
        self.assertFalse(diff["ok"])
        bad = [e for e in diff["entries"] if e["problems"]]
        self.assertEqual(len(bad), 1)
        self.assertEqual(bad[0]["expected"]["userText"], "F12 会被打断的 prompt")
        self.assertIn("agentHead", bad[0]["problems"][0])

    def test_a_missing_entry_breaks_the_order(self):
        rows = screen("card-2.1.295.txt")
        rows = [r for r in rows if "F14" not in r and "无文字回复" not in r]
        diff = toc_verifier.compare_window(forms_groups(), toc_verifier.parse_pane(rows))
        self.assertFalse(diff["ok"])

    def test_a_truncated_body_is_a_prefix_and_a_wrong_time_is_named(self):
        rows = [r.replace("F16 压缩之前的最后一轮              09:06", "F16 压缩之…                         09:08")
                for r in screen("card-2.1.295.txt")]
        diff = toc_verifier.compare_window(forms_groups(), toc_verifier.parse_pane(rows))
        problems = [p for e in diff["entries"] for p in e["problems"]]
        self.assertEqual(len(problems), 1, problems)
        self.assertIn("time", problems[0])

    def test_reads_a_hollow_mark_as_a_side_without_a_jump_target(self):
        rows = [r.replace("●  F16", "○  F16").replace("├╴ F16 回复", "├┄ F16 回复") for r in screen("card-2.1.295.txt")]
        pane = toc_verifier.parse_pane(rows)
        f16 = next(e for e in pane.entries if e.user_text.startswith("F16"))
        self.assertEqual((f16.user_off, f16.agent_off), (True, True))
        self.assertEqual(sum(e.user_off or e.agent_off for e in pane.entries), 1)
        self.assertTrue(toc_verifier.compare_window(forms_groups(), pane)["ok"])

    def test_a_wrong_day_rule_is_named(self):
        rows = screen("compact-2.1.295.txt")
        rows[4] = rows[4][:126] + "─ 10月8日 " + "─" * 34                       # a rule above the first entry
        diff = toc_verifier.compare_window(forms_groups(), toc_verifier.parse_pane(rows))
        problems = [p for e in diff["entries"] for p in e["problems"]]
        self.assertEqual(len(problems), 1, problems)
        self.assertIn("day", problems[0])


if __name__ == "__main__":
    unittest.main()
