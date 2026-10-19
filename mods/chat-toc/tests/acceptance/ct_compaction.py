#!/usr/bin/env python3
"""PTY scenarios for compactions and context use (chat-toc 0.2 spec §5,
ticket 14). Every placement verdict comes from toc_verifier against the
session's own transcript file.

  CT-CMPCT-001  rules from a fixture: a manual compaction after the /compact
                entry, an auto one at a submit before its group, one mid-turn
                after its group, three in a row folded to ×3; in all three
                Layouts and under every View filter. A file starting at a
                foreign boundary shows the fork line; one holding the whole
                conversation does not. A live /compact (below) too.
  CT-CTX-001    a new session against a local stand-in for the Messages API
                that states chosen `usage` figures: no context use before the
                first response; in the footer after it; hidden at /compact
                (whose rule goes after the /compact entry: CT-LIFE-003 as
                changed by 0.2) and back with the next response; in the band
                above the prompt once the Pane is closed; the shorter footer
                form at 36 columns.

CT-CMPCT-001's query part: with the query 合成 (K00, K01, K04, K05) the
rules go between the matches, folded where several fall in one place.

    $PY ct_compaction.py [--host current|2.1.287] [--only fixture,fork,live] [--out DIR]

No model is called: the fixture worlds are logged out, the live one talks to
fake_api on 127.0.0.1 only.
"""
import argparse
import json
import pathlib
import re
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import fake_api  # noqa: E402
import pty_harness as h  # noqa: E402
import toc_verifier as v  # noqa: E402
import transcript_fixture as tf  # noqa: E402

PLUGIN = HERE.parent.parent
SESSION = "00000000-0000-4000-8000-0000000014c0"
FAKE_KEY = "sk-ant-api03-fake-chat-toc-gate-000000000000"
LINES = 64                                              # every group in one window beside the preview (ticket 13)


def pane(t):
    return v.parse_pane(t.rows())


def listed(t):
    p = pane(t)
    return p if p is not None and p.entries else None


def pointer_off(t):
    t._write("\x1b[<35;6;6M")
    t.settle(quiet=0.5)


def click_text(t, text):
    t.settle(quiet=0.6)
    at = t.find(text)
    if at is None:
        raise h.ScenarioFailure(f"no {text!r} on screen")
    t.click(at[1] + 1, at[0])
    t.settle(quiet=0.8)
    pointer_off(t)


# ---------- the fixture ----------

def write_fixture(world, host) -> pathlib.Path:
    """K00; a manual /compact as the host writes it; K01; K02 compacted at
    its submit; K03 compacted mid-turn; K04, then three compactions in a row
    between turns; K05."""
    path = world.transcript(SESSION)
    t = tf.Transcript(path, str(world.project), SESSION, seed=14, version=host.version)
    t.prompt("K00 合成问题")
    t.reply("K00 合成回复")
    t.compact("manual")
    t.local_command_user_row("compact", "", "Compacted")
    t.prompt("K01 合成问题")
    t.reply("K01 合成回复")
    t.prompt("K02 提交时压缩")
    t.compact("auto")
    t.reply("K02 压缩后的回复")
    t.prompt("K03 轮中压缩")
    t.tool("k03")
    t.compact("auto")
    t.reply("K03 继续的回复")
    t.prompt("K04 合成问题")
    t.reply("K04 合成回复")
    for _ in range(3):
        t.compact("auto")
    t.prompt("K05 合成问题")
    t.reply("K05 合成回复")
    t.close()
    return path


def check_rules(t, path, label, evidence, query: str | None = None) -> dict:
    """The one window against the verifier: every listed group shown, and the
    rules in place with their words. With a query, the groups whose User
    input holds it (the fixture's words are in the input and the reply
    alike) are the ones listed."""
    toc = v.expected_toc(path)
    p = v.parse_pane(t.settle(quiet=0.8))
    evidence.append(t.snap(label))
    if p is None:
        return {"ok": False, "error": "no Pane"}
    among = None if query is None else [i for i, g in enumerate(toc.groups) if query in g.user_text]
    rules = v.compare_rules(toc, p, among=among)
    whole = len(p.entries) == len(v.listed([g for i, g in enumerate(toc.groups) if among is None or i in among], p.filter))
    return {"ok": rules["ok"] and whole, "filter": p.filter, "layout": p.layout, "expected": rules["expected"],
            "actual": rules["actual"], "allListed": whole, "notes": p.notes}


def fixture(world, host, run):
    path = write_fixture(world, host)
    t = h.launch(world, host, [PLUGIN], ["--resume", SESSION], run=run, lines=LINES)
    evidence, actual = [], {}
    try:
        t.wait_for(listed, "the Pane with entries", timeout=40)
        pointer_off(t)
        actual["card all"] = check_rules(t, path, "card, All", evidence)
        click_text(t, "l: 布局")
        actual["compact all"] = check_rules(t, path, "compact, All", evidence)
        click_text(t, "l: 布局")
        actual["timeline all"] = check_rules(t, path, "timeline, All", evidence)
        click_text(t, "l: 布局")
        click_text(t, "2: 用户")
        actual["card user"] = check_rules(t, path, "card, User", evidence)
        click_text(t, "3: Agent")
        actual["card agent"] = check_rules(t, path, "card, Agent", evidence)
        click_text(t, "1: 全部")
        actual["folded"] = any("×3" in r["text"] for r in actual["card all"].get("actual", []))
        search = pane(t).filter_row + 2                       # the search row: a click gives the field the keys
        t.click(pane(t).left + 10, search)
        time.sleep(0.5)
        t._write("合成")
        t.wait_for(lambda term: (q := pane(term)) is not None and (q.search or {}).get("text") == "合成", "the query 合成", timeout=10)
        t.key("esc")
        pointer_off(t)
        actual["card all 合成"] = check_rules(t, path, "card, All, query 合成", evidence, query="合成")
        actual["queryFolded"] = any("×2" in r["text"] for r in actual["card all 合成"].get("actual", []))
        actual["forkLine"] = pane(t).fork_line
    finally:
        t.close()
    ok = (all(actual[k]["ok"] for k in actual if isinstance(actual[k], dict)) and actual["folded"] and actual["queryFolded"]
          and not actual["forkLine"])
    return ("rules as the verifier places them: manual after the /compact entry, auto at a submit before its group, "
            "mid-turn after its group, three in a row as one ×3 rule; in card, compact and timeline and under All, User "
            "and Agent; with the query 合成 between its matches K00, K01, K04, K05, the two before K04 as one ×2 rule; no fork "
            "line in a file holding the whole conversation", actual, ok, evidence)


def fork(world, host, run):
    path = world.transcript(SESSION)
    t = tf.Transcript(path, str(world.project), SESSION, seed=15, version=host.version)
    t.compact("manual", logical_parent="00000000-0000-4000-8000-00000000dead")
    t.local_command_user_row("compact", "", "Compacted")
    t.prompt("F00 分叉之后的合成问题")
    t.reply("F00 合成回复")
    t.close()
    term = h.launch(world, host, [PLUGIN], ["--resume", SESSION], run=run, lines=LINES)
    evidence, actual = [], {}
    try:
        term.wait_for(listed, "the Pane with entries", timeout=40)
        pointer_off(term)
        p = v.parse_pane(term.settle())
        evidence.append(term.snap("a file starting at a foreign boundary"))
        toc = v.expected_toc(path)
        actual["expectedForkLine"] = toc.earlier_elsewhere
        actual["forkLine"] = p.fork_line
        rows = term.rows()
        fork_row = next((y for y, r in enumerate(rows) if v._FORK_LINE in r), None)
        rule_row = next((y for y, r in enumerate(rows) if "╌ 已压缩" in r), None)
        actual["forkLineAboveRule"] = fork_row is not None and rule_row is not None and fork_row < rule_row
        actual["rules"] = v.compare_rules(toc, p)
    finally:
        term.close()
    ok = actual["expectedForkLine"] and actual["forkLine"] and actual["forkLineAboveRule"] and actual["rules"]["ok"]
    return ("a file starting at a boundary whose parent it does not hold shows 更早的轮次不在本会话的文件里 at the list's top, "
            "above the first rule", actual, ok, evidence)


# ---------- the live session ----------

class UsageApi(fake_api.FakeApi):
    """Answers every streamed request with a short text and states `usage`:
    the input side in message_start, the output in message_delta."""

    usage = {"input_tokens": 3, "cache_creation_input_tokens": 2000, "cache_read_input_tokens": 618000, "output_tokens": 250}

    def answer(self, handler, body):
        path = handler.path
        if "/messages" in path and "count_tokens" not in path and body.get("stream"):
            self.count += 1
            n = self.count
            self.requests.append({"path": path, "usage": dict(self.usage)})
            events = fake_api._message([{"type": "text", "text": "ok"}], "end_turn", n)
            u = dict(self.usage)
            events[0]["message"]["usage"] = {k: x for k, x in u.items() if k != "output_tokens"} | {"output_tokens": 1}
            for e in events:
                if e["type"] == "message_delta":
                    e["usage"] = {"output_tokens": u["output_tokens"]}
            try:
                handler._send(200, "text/event-stream", fake_api._sse(events))
            except BrokenPipeError:
                pass
            return
        super().answer(handler, body)


def footer(t) -> str | None:
    p = pane(t)
    return p.footer if p is not None else None


def prompt(t, text):
    t.type(text)
    time.sleep(0.4)
    t.key("enter")


def live(world, host, run):
    cfg = json.loads((world.config / ".claude.json").read_text())
    cfg["customApiKeyResponses"] = {"approved": [FAKE_KEY[-20:]], "rejected": []}
    (world.config / ".claude.json").write_text(json.dumps(cfg))
    path = world.transcript(SESSION)
    evidence, actual = [], {}
    with UsageApi("CT-NONE", str(world.project / "none.txt")) as api:
        t = h.launch(world, host, [PLUGIN], ["--session-id", SESSION], run=run, lines=LINES,
                     env={"ANTHROPIC_BASE_URL": api.url, "ANTHROPIC_API_KEY": FAKE_KEY})
        try:
            t.wait_for(lambda term: pane(term) is not None, "the Pane", timeout=40)
            rows = t.settle()
            evidence.append(t.snap("ctx before the first response"))
            actual["beforeFirstResponse"] = not any("上下文已用" in r for r in rows)

            prompt(t, "CT-CTX 第一轮合成问题")
            t.wait_for(lambda term: (footer(term) or "").endswith("上下文已用 62%"), "62% in the footer", timeout=40)
            pointer_off(t)
            evidence.append(t.snap("ctx after the first response"))
            actual["afterFirstResponse"] = footer(t)

            t.command("/compact", wait=1)
            t.wait_for(lambda term: (p := pane(term)) is not None and p.rules, "a compaction rule", timeout=60)
            t.settle(quiet=1.5)
            pointer_off(t)
            evidence.append(t.snap("ctx after /compact"))
            actual["afterCompact"] = footer(t)
            actual["hiddenAfterCompact"] = "上下文" not in (footer(t) or "x 上下文") and footer(t) is not None
            toc = v.expected_toc(path)
            rules = v.compare_rules(toc, pane(t))
            actual["compactRule"] = rules
            commands = [i for i, g in enumerate(toc.groups) if g.user_text.startswith("/compact")]
            actual["ruleAfterCompactEntry"] = rules["ok"] and bool(commands) and any(
                c.before == commands[-1] + 1 and c.trigger == "manual" for c in toc.compactions)

            api.usage = dict(api.usage, cache_read_input_tokens=468000)
            prompt(t, "CT-CTX 压缩之后的合成问题")
            t.wait_for(lambda term: (footer(term) or "").endswith("上下文已用 47%"), "47% in the footer", timeout=40)
            pointer_off(t)
            evidence.append(t.snap("ctx back with the next response"))
            actual["afterNextResponse"] = footer(t)

            p = pane(t)
            mark = next(((y, x) for y, r in enumerate(t.rows()) for x in [r.rfind("✕")] if x > 0), None)
            if mark is None:
                raise h.ScenarioFailure("no ✕ on the Pane")
            row = t.rows()[mark[0]]
            t.click(sum(h.cell_width(c) for c in row[:mark[1]]), mark[0])
            t.wait_for(lambda term: term.find("ChatTOC  ‹ ›") is not None, "the band above the prompt", timeout=15)
            t.settle()
            evidence.append(t.snap("ctx in the band"))
            band = next((r for r in t.rows() if "ChatTOC  ‹ ›" in r), "")
            actual["band"] = band.strip()
            actual["bandHasContext"] = "· 上下文已用 47%" in band

            t.command("/chat-toc", wait=1)
            t.wait_for(lambda term: pane(term) is not None, "the Pane again", timeout=15)
            t.type("l")
            time.sleep(0.4)
            t.type("l")
            t.wait_for(lambda term: (p := pane(term)) is not None and p.layout == "时间轴", "the timeline Layout", timeout=10)
            evidence.append(t.snap("ctx timeline at 44 columns"))
            actual["timeline44"] = footer(t)
            for _ in range(2):
                t._write("\x18")
                time.sleep(0.25)
                t._write("\x1b[C")
                time.sleep(0.6)
            t.settle(quiet=1.0)
            evidence.append(t.snap("ctx timeline at 36 columns"))
            rows = t.rows()
            rule = next((r for r in rows if re.search(r"│─{30,}$", r)), "")
            actual["paneColumns36"] = len(rule.rsplit("│", 1)[-1]) if rule else None
            actual["timeline36"] = footer(t)
            t.key("esc")
        except h.ScenarioFailure as failure:
            actual["failure"] = str(failure)
        finally:
            t.close()
    shorter = re.fullmatch(r"\d+ 轮 · 已用 47%", actual.get("timeline36") or "") is not None
    ok = ("failure" not in actual and actual["beforeFirstResponse"]
          and re.fullmatch(r"\d+ 轮 · 上下文已用 62%", actual["afterFirstResponse"] or "")
          and actual["hiddenAfterCompact"] and actual["ruleAfterCompactEntry"]
          and re.fullmatch(r"\d+ 轮 · 上下文已用 47%", actual["afterNextResponse"] or "") and actual["bandHasContext"]
          and actual.get("paneColumns36") == 36 and shorter)
    return ("no context use before the first response; 上下文已用 62% after it; hidden at /compact, whose rule goes after "
            "the /compact entry (verifier); 上下文已用 47% with the next response; the band says it once the Pane is "
            "closed; at 36 columns in the timeline Layout the footer says 已用 47%", actual, bool(ok), evidence)


SCENARIOS = {
    "fixture": ("CT-CMPCT-001", fixture),
    "fork": ("CT-CMPCT-001", fork),
    "live": ("CT-CTX-001", live),
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", default="current")
    parser.add_argument("--only", default="")
    parser.add_argument("--out", type=pathlib.Path)
    args = parser.parse_args()
    host = h.Host(args.host)
    run = h.Run(args.out, f"compaction-{host.version}")
    failed = 0
    for name in [n for n in args.only.split(",") if n] or list(SCENARIOS):
        scenario, fn = SCENARIOS[name]
        world = h.World(token="")
        try:
            expected, actual, ok, evidence = fn(world, host, run)
            result = "pass" if ok else "fail"
        except h.ScenarioFailure as error:
            expected, actual, ok, evidence, result = name, {"error": str(error)}, False, [], "fail"
        finally:
            world.remove()
        actual = json.loads(json.dumps(actual, default=str))
        run.record(scenario, host=host.version, plugin=str(PLUGIN), fixture=name, expected=expected,
                   actual=actual, result=result, evidence=evidence)
        if name == "live":
            # the /compact part is CT-LIFE-003 as 0.2 changes it
            life = ok or (actual.get("hiddenAfterCompact") and actual.get("ruleAfterCompactEntry")
                          and str(actual.get("afterNextResponse", "")).endswith("47%"))
            run.record("CT-LIFE-003", host=host.version, plugin=str(PLUGIN), fixture="live /compact",
                       expected="after /compact the rule shows after the /compact entry and the context use hides "
                                "until the next response",
                       actual={k: actual.get(k) for k in ("afterCompact", "hiddenAfterCompact", "ruleAfterCompactEntry",
                                                          "compactRule", "afterNextResponse")},
                       result="pass" if life else "fail", evidence=evidence)
        print(f"{name} ({scenario}) on {host.version}: {result}")
        failed += not ok
    print("run directory:", run.dir)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
