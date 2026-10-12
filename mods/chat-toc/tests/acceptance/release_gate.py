#!/usr/bin/env python3
"""chat-toc's release gate: every MUST scenario on one Claude Code version,
then the evidence directory built from the runs.

    $PY release_gate.py run --host 2.1.287 --gate DIR [--types D.TS] [--skip-perf] [--only-perf]
    $PY release_gate.py report --gate DIR --out mods/chat-toc/tests/evidence/<version> --commit <hash>

`run` writes DIR/<Claude Code version>/: logs/ (plugin validate, plugin test,
tsc, the acceptance unit tests, every script's output) and runs/ (one run
directory per PTY script, CHAT_TOC_PTY_RUNS pointing there). `--types` is
the host's own claude-code.d.ts for tsc on a version newer than the minimum
(the plugin's tsconfig checks against 2.1.287's). The PTY scripts:

  ct_compat.py         CT-COMPAT-003
  ct_marketplace.py    CT-COMPAT-002 (local directory marketplace)
  ct_life.py           CT-LIFE-001, 002, 005 (fork before the first submit)
  chain_scenarios.py   CT-LIFE-003, 004, 005, CT-DATA-006
  jump_scenarios.py    CT-JUMP-001..003
  position_scenarios.py CT-POS-001..003, CT-COEX-001, CT-LIFE-006
  gate_scenarios.py    CT-COMPAT-001, CT-DATA-001..005, CT-TURN-001..005, CT-UI-001..004, CT-SEC-001
  perf_scenarios.py    CT-PERF-001 (20 MiB many and heavy, 3 runs each)

`report` gathers every run.jsonl record, checks that each MUST scenario of
the acceptance contract has records on every version and that all of them
pass (zero failed, missing or skipped), copies the evidence the records name
into the evidence directory with local paths replaced (<repo>, <home>,
<tmp>, <npx>), scans it for CT-SEC-001's markers, and writes report.json and
report.md.
"""
import argparse
import datetime
import json
import os
import pathlib
import platform
import re
import shutil
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
PLUGIN = HERE.parent.parent
REPOSITORY = PLUGIN.parent.parent
sys.path.insert(0, str(HERE))
import pty_harness as h  # noqa: E402

MUST = (["CT-COMPAT-001", "CT-COMPAT-002", "CT-COMPAT-003"]
        + [f"CT-DATA-00{i}" for i in range(1, 7)] + [f"CT-TURN-00{i}" for i in range(1, 6)]
        + [f"CT-LIFE-00{i}" for i in range(1, 7)] + [f"CT-UI-00{i}" for i in range(1, 5)]
        + [f"CT-JUMP-00{i}" for i in range(1, 4)] + [f"CT-POS-00{i}" for i in range(1, 4)]
        + ["CT-PERF-001", "CT-SEC-001", "CT-COEX-001"])
MARKERS = PLUGIN / "build" / "sec-001-markers.txt"
LAYOUTS = REPOSITORY / ".scratch" / "chat-toc" / "assets" / "25-layouts"


def sh(argv, log, cwd=REPOSITORY, env=None, timeout=None):
    began = datetime.datetime.now()
    out = subprocess.run(argv, cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout)
    log.parent.mkdir(parents=True, exist_ok=True)
    log.write_text(f"$ {' '.join(map(str, argv))}\n# {began.isoformat(timespec='seconds')}, exit {out.returncode}\n"
                   + out.stdout + out.stderr)
    print(f"{log.name}: exit {out.returncode}", flush=True)
    return out.returncode


def run_gate(args) -> int:
    host = h.Host(args.host)
    base = args.gate / host.version
    logs, runs = base / "logs", base / "runs"
    runs.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "CHAT_TOC_PTY_RUNS": str(runs)}
    env.pop("CHAT_TOC_PTY_TOKEN", None)                 # logged out: no model call
    py = sys.executable
    v = args.host
    codes = {}
    if not args.only_perf:
        codes["plugin-validate"] = sh([host.binary, "plugin", "validate", str(PLUGIN)], logs / "plugin-validate.log")
        if args.host == "current":
            codes["plugin-test"] = sh([host.binary, "plugin", "test", str(PLUGIN)], logs / "plugin-test.log", timeout=900)
            codes["acceptance-unit"] = sh([sys.executable, "-m", "unittest", "test_toc_verifier", "test_transcript_fixture",
                                           "test_pty_harness"], logs / "acceptance-unit.log", cwd=HERE)
        if args.types:
            config = base / "tsconfig.json"
            config.write_text(json.dumps({"extends": str(PLUGIN / "tsconfig.json"), "compilerOptions": {"noEmit": True},
                                          "include": [str(args.types), *(str(PLUGIN / d) for d in ("types", "hooks", "tests"))]},
                                         indent=1))
            codes["tsc"] = sh(["npx", "-y", "-p", "typescript@5.6.3", "tsc", "-p", str(config)], logs / "tsc.log")
        elif host.version == "2.1.287":
            codes["tsc"] = sh(["npx", "-y", "-p", "typescript@5.6.3", "tsc", "-p", "tsconfig.json"], logs / "tsc.log", cwd=PLUGIN)
        scripts = [
            ("ct-compat", [py, HERE / "ct_compat.py", "--host", v, "--out", runs / "ct-compat"]),
            ("ct-marketplace", [py, HERE / "ct_marketplace.py", "--host", v, "--source", "local", "--out", runs / "ct-marketplace"]),
            ("ct-life", [py, HERE / "ct_life.py", "--host", v, "--out", runs / "ct-life"]),
            ("chain", [py, HERE / "chain_scenarios.py", "--host", v, "--out", runs / "chain"]),
            ("jump", [py, HERE / "jump_scenarios.py", v]),
            ("position", [py, HERE / "position_scenarios.py", v]),
            ("gate", [py, HERE / "gate_scenarios.py", "--host", v, "--out", runs / "gate"]),
        ]
        for name, argv in scripts:
            codes[name] = sh([str(a) for a in argv], logs / f"{name}.log", env=env, timeout=5400)
        if args.screens and LAYOUTS.exists():
            codes["layout-screens"] = sh([py, str(LAYOUTS / "capture.py"), v], logs / "layout-screens.log", env=env, timeout=3600)
    if not args.skip_perf:
        for kind in ("many", "heavy"):
            codes[f"perf-{kind}"] = sh([py, str(HERE / "perf_scenarios.py"), "run", v, kind, "--runs", "3",
                                        "--out", str(runs / f"perf-{kind}")], logs / f"perf-{kind}.log", env=env, timeout=7200)
    (base / "codes.json").write_text(json.dumps(codes, indent=1))
    print(json.dumps(codes))
    return 0 if all(c == 0 for c in codes.values()) else 1


# ---------- the report ----------

def redactor():
    home = str(pathlib.Path.home())
    pairs = [(str(REPOSITORY), "<repo>"), (str(PLUGIN.resolve()), "<repo>/mods/chat-toc")]
    patterns = [(re.compile(r"(/private)?/var/folders/[^\s\"'<>]*?/ctoc-[A-Za-z0-9_]+"), "<tmp>"),
                (re.compile(re.escape(home) + r"/\.npm/_npx/[0-9a-f]+"), "<npx>"),
                (re.compile(r"(/private)?/tmp/claude-\d+/[^\s\"'<>]*"), "<tmp>")]

    def redact(text: str) -> str:
        for old, new in pairs:
            text = text.replace(old, new)
        for pattern, new in patterns:
            text = pattern.sub(new, text)
        return text.replace(home, "<home>")
    return redact


def scenario_id(name: str) -> str:
    m = re.match(r"CT-[A-Z]+-\d{3}", name)
    return m.group(0) if m else name


def copy_text(src: pathlib.Path, dst: pathlib.Path, redact) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    if src.suffix == ".log" and src.stat().st_size > 400_000:
        # a host debug log: chat-toc's own lines only, its timings left to
        # the run's perf-samples-*.json (perf_scenarios.py extracts them)
        chatter = re.compile(r"chat-toc-perf |(ui\.render|ui\.scroll) settled in|ui\.scroll Pane chat-toc \(person\)")
        lines = [line for line in src.read_text(errors="replace").splitlines()
                 if "chat-toc" in line and not chatter.search(line)]
        dst.write_text("# chat-toc's lines of the host debug log, without the per-frame ui.render/ui.scroll timings and "
                       "the chat-toc-perf lines (those are in perf-samples-*.json)\n" + redact("\n".join(lines)) + "\n")
        return
    try:
        dst.write_text(redact(src.read_text(encoding="utf-8")), encoding="utf-8")
    except UnicodeDecodeError:
        shutil.copyfile(src, dst)


def short(value, limit=160) -> str:
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    return text if len(text) <= limit else text[:limit - 1] + "…"


def report(args) -> int:
    redact = redactor()
    out = args.out
    if out.exists():
        shutil.rmtree(out)
    (out / "logs").mkdir(parents=True)
    plugin_version = json.loads((PLUGIN / ".claude-plugin" / "plugin.json").read_text())["version"]
    versions = sorted(p.name for p in args.gate.iterdir() if p.is_dir() and re.fullmatch(r"\d+\.\d+\.\d+", p.name))
    records, gates = [], []
    for version in versions:
        base = args.gate / version
        codes = json.loads((base / "codes.json").read_text()) if (base / "codes.json").exists() else {}
        for name in ("plugin-validate", "plugin-test", "tsc", "acceptance-unit"):
            log = base / "logs" / f"{name}.log"
            if not log.exists():
                continue
            text = log.read_text(errors="replace")
            link = f"logs/{name}@{version}.log"
            copy_text(log, out / link, redact)
            detail = None
            if name == "plugin-test":
                m = re.search(r"(\d+) pass\s+(\d+) fail", text)
                detail = f"{m.group(1)} pass, {m.group(2)} fail" if m else None
                detail = (detail + "; " if detail else "") + "; ".join(l.strip() for l in text.splitlines() if l.startswith("CT-PERF"))
            if name == "acceptance-unit":
                m = re.search(r"Ran (\d+) tests", text)
                detail = f"{m.group(1)} tests" if m else None
            passed = codes.get(name.replace("plugin-validate", "plugin-validate"), 1) == 0 and (
                name != "plugin-validate" or "Validation passed" in text)
            gates.append({"name": f"{name}@{version}", "outcome": "pass" if passed else "fail", "link": link, "detail": detail})
        for run_dir in sorted({p.parent for p in (base / "runs").rglob("run.jsonl")}):
            rel_run = pathlib.Path("pty") / version / run_dir.relative_to(base / "runs")
            for line in (run_dir / "run.jsonl").read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue
                r = json.loads(line)
                links = []
                for e in r.get("evidence", []):
                    src = (run_dir / e) if not pathlib.Path(e).is_absolute() else pathlib.Path(e)
                    if src.is_file():
                        try:
                            rel = src.resolve().relative_to(run_dir.resolve())
                        except ValueError:
                            rel = pathlib.Path(src.name)
                        copy_text(src, out / rel_run / rel, redact)
                        links.append(str(rel_run / rel))
                records.append({
                    "pluginVersion": plugin_version, "claudeCodeVersion": r["host"], "os": r["os"], "arch": r["arch"],
                    "fixture": r["fixture"], "scenario": scenario_id(r["scenario"]), "name": r["scenario"],
                    "expected": r["expected"], "actual": json.loads(redact(json.dumps(r["actual"], ensure_ascii=False))),
                    "result": r["result"], "evidence": links, "commit": args.commit, "at": r["at"],
                    "plugin": redact(r["plugin"]), **({"notes": r["notes"]} if r.get("notes") else {})})
            copy_text(run_dir / "run.jsonl", out / rel_run / "run.jsonl", redact)
    # the sign-off screens: the three Layouts at 36/44/56 columns on each version
    signoff = []
    for folder in sorted((PLUGIN / "build" / "pty-runs").glob("ct25-layouts-*")) if args.screens else []:
        version = folder.name.split("-")[2]
        if version == "current":
            version = next((v for v in versions if v != "2.1.287"), version)
        for screen in sorted(folder.glob("screens/*.txt")):
            dst = out / "signoff" / f"{version}-{folder.name.split('-')[-1]}" / screen.name
            copy_text(screen, dst, redact)
            signoff.append(str(dst.relative_to(out)))

    coverage = {sid: {} for sid in MUST}
    for r in records:
        if r["scenario"] in coverage:
            cell = coverage[r["scenario"]].setdefault(r["claudeCodeVersion"], {"pass": 0, "fail": 0, "skip": 0})
            cell[r["result"]] += 1
    missing = [(sid, v) for sid in MUST for v in versions if v not in coverage[sid]]
    failed = [r for r in records if r["result"] == "fail"]
    skipped = [r for r in records if r["result"] == "skip"]
    extra = sorted({r["scenario"] for r in records} - set(MUST))

    markers = [m.strip() for m in MARKERS.read_text().splitlines() if m.strip()] if MARKERS.exists() else []
    leaks = []
    for path in out.rglob("*"):
        if path.is_file():
            text = path.read_text(errors="replace")
            leaks += [str(path.relative_to(out)) for m in markers if m in text]
    gates.append({"name": "privacy-scan", "outcome": "pass" if markers and not leaks else "fail", "link": None,
                  "detail": f"{len(markers)} CT-SEC-001 marker(s), {len(leaks)} leak(s) in the evidence"})
    bad_gates = [g for g in gates if g["outcome"] != "pass"]
    overall = "pass" if not (missing or failed or skipped or bad_gates) else "fail"
    identity = {
        "commit": args.commit, "pluginVersion": plugin_version, "claudeCodeVersions": versions,
        "minimumClaudeCode": "2.1.287", "os": f"macOS {platform.mac_ver()[0]}", "arch": platform.machine(),
        "cpu": subprocess.run(["sysctl", "-n", "machdep.cpu.brand_string"], capture_output=True, text=True).stdout.strip(),
        "surface": "interactive terminal, fullscreen layout (pseudo-terminal read through pyte 0.8.2, 170x44 unless a scenario says otherwise)",
        "loading": "--plugin-dir for every scenario; CT-COMPAT-002 through a local directory marketplace",
        "functionHooks": "not set (chat-toc does not need CLAUDE_CODE_ENABLE_FUNCTION_HOOKS)",
        "account": "logged out; no model call (CT-TURN-004's live turn runs against fake_api.py, a local scripted stand-in)",
        "python": platform.python_version(),
    }
    counts = {k: sum(r["result"] == k for r in records) for k in ("pass", "fail", "skip")}
    data = {"formatVersion": 1, "overall": overall, "identity": identity, "versions": versions,
            "counts": {**counts, "missing": len(missing)}, "gates": gates,
            "coverage": coverage, "missing": [f"{s}@{v}" for s, v in missing], "extraScenarios": extra,
            "leaks": leaks, "signoffScreens": signoff, "records": records}
    (out / "report.json").write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n")
    perf_dirs = [p.parent for p in args.gate.glob("*/runs/perf-*/run.jsonl")]
    perf = subprocess.run([sys.executable, str(HERE / "perf_scenarios.py"), "table", *map(str, perf_dirs)],
                          capture_output=True, text=True).stdout.strip() if perf_dirs else "（没有 CT-PERF-001 运行）"
    (out / "report.md").write_text(markdown(data, perf), encoding="utf-8")
    print(f"overall {overall}: {counts}, missing {len(missing)}, gates failing {[g['name'] for g in bad_gates]}, leaks {len(leaks)}")
    return 0 if overall == "pass" else 1


def markdown(d: dict, perf: str) -> str:
    i, versions = d["identity"], d["versions"]
    lines = [f"# chat-toc {i['pluginVersion']} 发布证据", "",
             f"**结论：{'通过' if d['overall'] == 'pass' else '未通过'}**（`--plugin-dir` 下 {len(MUST)} 个 MUST 场景 × "
             f"{len(versions)} 个 Claude Code 版本；失败 {d['counts']['fail']}、缺失 {d['counts']['missing']}、跳过 "
             f"{d['counts']['skip']}；证据里 CT-SEC-001 标记泄漏 {len(d['leaks'])} 处）", "",
             "## 被测对象与环境", ""]
    lines += [f"- {k}: `{v}`" if not isinstance(v, list) else f"- {k}: `{', '.join(v)}`" for k, v in i.items()]
    lines += ["", "只用合成 prompt；transcript 都是 `tests/acceptance/transcript_fixture.py` 生成的或在隔离世界里新提交的。"
              "本机路径换成了 `<repo>`、`<home>`、`<tmp>`、`<npx>`。", "", "## 自动化门禁", "",
              "| 门禁 | 结果 | 说明 | 日志 |", "| --- | --- | --- | --- |"]
    for g in d["gates"]:
        log = f"[log]({g['link']})" if g["link"] else ""
        lines.append(f"| {g['name']} | {g['outcome']} | {g['detail'] or ''} | {log} |")
    lines += ["", "## MUST 场景（定稿兼容与验收契约 §4 及其后续修订）", "",
              "每格是该版本上这个场景 ID 的记录数与结果（一个 ID 可以有多条记录，例如 CT-COMPAT-003 的五种情形）。", "",
              "| 场景 | " + " | ".join(versions) + " |", "|---|" + "---|" * len(versions)]
    for sid in MUST:
        cells = []
        for v in versions:
            c = d["coverage"][sid].get(v)
            cells.append("**缺失**" if not c else ("通过" if not c["fail"] and not c["skip"] else "**未通过**")
                         + f"（{c['pass']}/{c['pass'] + c['fail'] + c['skip']}）" if c else "**缺失**")
        lines.append(f"| {sid} | " + " | ".join(cells) + " |")
    lines += ["", "## CT-PERF-001（20 MiB，两种 fixture × 两个版本 × 3 次，取各次 p95 中最差的）", "", perf, "",
              "## 人工目检（待使用者签字）", "",
              "> 不是发布阻断项（契约 §3、§5）。实现者没有签这一项：请使用者看下面的截屏（以及在自己的终端里实际看一次），"
              "确认三种 Layout（卡片、紧凑、时间轴）的观感，以及高亮（主题的 `suggestion` 色）与反色选择光标能一眼分清，然后在本节填写。", "",
              "- 本次发布门禁重新截的屏（被测提交、两个版本、36/44/56 列，每组：卡片、紧凑、时间轴、卡片+只看用户、卡片+只看 Agent）："
              "`signoff/<版本>-<列宽>/`", "- 25 号票当时的截屏：`.scratch/chat-toc/assets/25-layouts/screens/`（2.1.287 与 2.1.295，36/44/56 列）",
              "- 高亮色与反色在文本截屏里看不出；颜色由 CT-UI-003（高亮 `▌` 是 dark 主题的 `suggestion`、不反色；"
              "选择光标反色，二者不在同一行）与 CT-UI-004（四种主题下高亮与淡化各是该主题的解析值）自动核对，观感仍需真人看。", "",
              "| 项 | 结论 | 签字 | 日期 |", "| --- | --- | --- | --- |",
              "| 三种 Layout 的观感 | 待填 | 待使用者签字 | |", "| 高亮与反色选择光标能分清 | 待填 | 待使用者签字 | |", "",
              "## 各场景记录", ""]
    for r in sorted(d["records"], key=lambda r: (MUST.index(r["scenario"]) if r["scenario"] in MUST else 999,
                                                  r["claudeCodeVersion"], r["name"])):
        links = ", ".join(f"[{pathlib.Path(e).name}]({e})" for e in r["evidence"][:6])
        more = f" 等 {len(r['evidence'])} 个" if len(r["evidence"]) > 6 else ""
        lines += [f"### {r['name']} · {r['claudeCodeVersion']} · {r['result']}", "",
                  f"- fixture: {r['fixture']}", f"- 预期: {r['expected']}", f"- 实际: `{short(r['actual'], 400)}`",
                  f"- 证据: {links}{more}" if links else "- 证据: 见 report.json", ""]
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--host", required=True)
    r.add_argument("--gate", required=True, type=pathlib.Path)
    r.add_argument("--types", type=pathlib.Path)
    r.add_argument("--skip-perf", action="store_true")
    r.add_argument("--only-perf", action="store_true")
    r.add_argument("--screens", action="store_true", help="also capture the three Layouts for the visual sign-off")
    p = sub.add_parser("report")
    p.add_argument("--gate", required=True, type=pathlib.Path)
    p.add_argument("--out", required=True, type=pathlib.Path)
    p.add_argument("--commit", required=True)
    p.add_argument("--screens", action="store_true", help="copy the sign-off screens from build/pty-runs/ct25-layouts-*")
    a = parser.parse_args()
    return run_gate(a) if a.cmd == "run" else report(a)


if __name__ == "__main__":
    sys.exit(main())
