#!/usr/bin/env python3
"""Fork experiments in a logged-out, throwaway world (no model call).

Builds a synthetic parent transcript (3 turns, a compaction, 2 turns), then on
the given host runs, each in its own launch:
  A  claude --resume P --fork-session   -> submit one prompt        (file F)
  B  claude --resume F --fork-session   -> submit one prompt        (file G, a fork of a fork)
  C  claude --resume F                  -> submit one prompt        (F grows, no new file)
  D  claude --resume P ; submit ; /branch ; submit                  (in-session fork, file H)
with fork-probe loaded, and writes a structural report (field names, shapes,
counts, synthetic ids; no prose) to <out>/report.json plus the probe's JSON
files and the world's transcripts' key skeletons.

    fork_experiment.py --binary <claude> --out <dir>
"""
import argparse
import json
import os
import pathlib
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
ACCEPT = HERE.parents[3] / "mods" / "chat-toc" / "tests" / "acceptance"
sys.path.insert(0, str(ACCEPT))
import pty_harness as H  # noqa: E402
import transcript_fixture as TF  # noqa: E402

PROBE = HERE / "fork-probe"
P_ID = "00000000-0000-4000-8000-0000000000a1"


class Host:
    def __init__(self, binary):
        import subprocess
        self.binary = binary
        self.version = subprocess.run([binary, "--version"], capture_output=True, text=True, check=True).stdout.split()[0]


def build_parent(world, host):
    path = TF.project_dir(world.config, str(world.project)) / f"{P_ID}.jsonl"
    t = TF.Transcript(path, str(world.project), P_ID, seed=3, version=host.version)
    pre = []
    for i in range(3):
        TF._turn(t, i, 1)
        pre.append(t.parent)
    pre_leaf = t.parent
    t.compact()
    summary = t.parent
    for i in range(3, 5):
        TF._turn(t, i, 1)
    post_leaf = t.parent
    t.close()
    return {"path": path, "pre_uuid": pre_leaf, "post_uuid": post_leaf, "summary": summary}


def project_files(world):
    d = TF.project_dir(world.config, str(world.project))
    return {p.stem: p for p in d.glob("*.jsonl")}


def read_rows(path):
    rows = []
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return rows


def skeleton(rows):
    """One tuple per row: (type, subtype, sorted keys of interest, forkedFrom shape)."""
    out = []
    for r in rows:
        out.append({
            "type": r.get("type"), "subtype": r.get("subtype"),
            "sessionId": r.get("sessionId"), "uuid": r.get("uuid"), "parentUuid": r.get("parentUuid", "<absent>"),
            "logicalParentUuid": r.get("logicalParentUuid", "<absent>"),
            "forkedFrom": r.get("forkedFrom", "<absent>"),
            "isCompactSummary": r.get("isCompactSummary"),
            "keys": sorted(r.keys()),
        })
    return out


def _walk(node, needle, path, hits):
    """Key paths (names only, lists as []) of every string that contains needle."""
    if isinstance(node, str):
        if needle in node:
            hits.append(path)
    elif isinstance(node, dict):
        for k, v in node.items():
            _walk(v, needle, path + [k], hits)
    elif isinstance(node, list):
        for v in node:
            _walk(v, needle, path + ["[]"], hits)


SAMPLES = []


def raw_refs(path, own_id, ids):
    """Where (row type, key path) another known session id appears, with counts."""
    out = {}
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except Exception:
            continue
        for i in ids:
            if i == own_id or i not in line:
                continue
            hits = []
            _walk(row, i, [], hits)
            for h in hits:
                if row.get("type") == "system" and h == ["content"]:
                    text = row["content"]
                    for n, j in enumerate(ids):
                        text = text.replace(j, f"<ID#{n}>")
                    SAMPLES.append({"file": own_id, "subtype": row.get("subtype"), "level": row.get("level"),
                                    "keys": sorted(row.keys()), "text": text[:300]})
                key = f"{row.get('type')}:{'.'.join(h)}"
                out.setdefault(i, {})
                out[i][key] = out[i].get(key, 0) + 1
    return out


def wait_prompt(term, timeout=40):
    # user rows in the resumed transcript also start with the prompt mark: wait for the bare composer and the hint line
    term.wait_for(lambda t: any(r.strip() == "❯" for r in t.rows()) and any("shortcuts" in r for r in t.rows()),
                  "the prompt", timeout=timeout)
    time.sleep(2.5)


def submit(term, text):
    term.type(text)
    time.sleep(0.5)
    term.key("enter")
    time.sleep(3.0)


def launch(world, host, args, probe_out, pre, post):
    probe_out = pathlib.Path(probe_out).resolve()
    env = {"PROBE_OUT": str(probe_out), "PROBE_PRE": pre or "", "PROBE_POST": post or ""}
    probe_out.mkdir(parents=True, exist_ok=True)
    return H.launch(world, host, [PROBE], args, columns=150, lines=50, env=env)


def run(binary, out):
    host = Host(binary)
    out = pathlib.Path(out) / f"host-{host.version}"
    out.mkdir(parents=True, exist_ok=True)
    world = H.World()
    report = {"host": host.version, "steps": {}}
    parent = build_parent(world, host)
    pre, post = parent["pre_uuid"], parent["post_uuid"]
    report["parent"] = {"rows": skeleton(read_rows(parent["path"]))}
    known = set(project_files(world))

    def new_file():
        nonlocal known
        now = project_files(world)
        added = [k for k in now if k not in known]
        known = set(now)
        return added

    def step(name, args, actions):
        probe_out = out / f"probe-{name}"
        term = launch(world, host, args, probe_out, pre, post)
        try:
            wait_prompt(term)
            actions(term)
        finally:
            term.snap(f"{name} end") if term.run else None
            term.close()
        return new_file()

    def probe(term):
        submit(term, "/forkprobe")

    # A: fork of the parent
    def a(term):
        probe(term)
        submit(term, "fork one")
    added = step("A", ["--resume", P_ID, "--fork-session"], a)
    report["steps"]["A_new_files"] = added
    f_id = added[0] if added else None
    if f_id:
        report["fork_F"] = {"id": f_id, "rows": skeleton(read_rows(project_files(world)[f_id]))}
    # P unchanged?
    report["parent_after_A_rows"] = len(read_rows(parent["path"]))

    if f_id:
        # B: fork of the fork
        def b(term):
            probe(term)
            submit(term, "fork two")
        added = step("B", ["--resume", f_id, "--fork-session"], b)
        report["steps"]["B_new_files"] = added
        if added:
            g = added[0]
            report["fork_G"] = {"id": g, "rows": skeleton(read_rows(project_files(world)[g]))}
        # C: plain resume of the fork
        before = len(read_rows(project_files(world)[f_id]))

        def c(term):
            probe(term)
            submit(term, "resume three")
        added = step("C", ["--resume", f_id], c)
        report["steps"]["C_new_files"] = added
        after_rows = read_rows(project_files(world)[f_id])
        report["resume_F"] = {"rows_before": before, "rows_after": len(after_rows),
                              "appended": skeleton(after_rows[before:])}

    # D: /branch inside a resumed parent
    def d(term):
        probe(term)
        submit(term, "before branch")
        submit(term, "/branch")
        time.sleep(2)
        submit(term, "/forkprobe")
        submit(term, "after branch")
    p_before = len(read_rows(parent["path"]))
    added = step("D", ["--resume", P_ID], d)
    report["steps"]["D_new_files"] = added
    report["parent_after_D"] = {"rows_before": p_before, "rows_after": len(read_rows(parent["path"]))}
    if added:
        h = added[0]
        report["branch_H"] = {"id": h, "rows": skeleton(read_rows(project_files(world)[h]))}

    # E: /branch of a /branch fork (H -> H2)
    if "branch_H" in report:
        h = report["branch_H"]["id"]

        def e(term):
            probe(term)
            submit(term, "/branch")
            time.sleep(2)
            submit(term, "after second branch")
        added = step("E", ["--resume", h], e)
        report["steps"]["E_new_files"] = added
        if added:
            report["branch_H2"] = {"id": added[0], "rows": skeleton(read_rows(project_files(world)[added[0]]))}
        # G2: --fork-session of the /branch fork (do forkedFrom rows keep their field?)

        def g2(term):
            probe(term)
            submit(term, "fork of branch")
        added = step("G2", ["--resume", h, "--fork-session"], g2)
        report["steps"]["G2_new_files"] = added
        if added:
            report["fork_I"] = {"id": added[0], "rows": skeleton(read_rows(project_files(world)[added[0]]))}

    # X: fork-session of P from another working directory (another projects folder)
    other = world.base / "project2"
    other.mkdir()
    cfg = json.loads((world.config / ".claude.json").read_text())
    cfg["projects"][str(other)] = {"hasTrustDialogAccepted": True, "hasCompletedProjectOnboarding": True}
    (world.config / ".claude.json").write_text(json.dumps(cfg))
    before_all = {str(p) for p in (world.config / "projects").rglob("*.jsonl")}
    probe_out = (out / "probe-X").resolve()
    probe_out.mkdir(parents=True, exist_ok=True)
    env = world.environment(True, {"PROBE_OUT": str(probe_out), "PROBE_PRE": "", "PROBE_POST": ""})
    term = H.PyteTerminal(world.argv(host, [PROBE], ["--resume", P_ID, "--fork-session"]), env, other, 150, 50)
    try:
        time.sleep(10)
        screen = term.rows()
        report["cross_cwd"] = {"screen_has_prompt": any(r.strip() == "❯" for r in screen),
                               "screen_non_empty_rows": sum(1 for r in screen if r.strip()),
                               "screen_head": [r[:110] for r in screen if r.strip()][:6]}
        if report["cross_cwd"]["screen_has_prompt"]:
            submit(term, "cross cwd")
    finally:
        term.close()
    after_all = {str(p) for p in (world.config / "projects").rglob("*.jsonl")}
    report["cross_cwd"]["new_files"] = [str(pathlib.Path(p).relative_to(world.config / "projects")).split("/")[0].replace(str(world.base).replace("/", "-"), "<base>")[-40:] + "/" + pathlib.Path(p).name[:8] for p in sorted(after_all - before_all)]
    # raw mentions of other session ids, per produced file
    all_ids = [P_ID] + [report[k]["id"] for k in ("fork_F", "fork_G", "branch_H", "branch_H2", "fork_I") if k in report]
    report["raw_refs"] = {i: raw_refs(project_files(world)[i], i, all_ids) for i in all_ids if i in project_files(world)}
    report["system_content_samples"] = SAMPLES
    report["raw_ref_key"] = dict(zip(all_ids, ["P", "F", "G", "H", "H2", "I"]))
    (out / "report.json").write_text(json.dumps(report, indent=1))
    # keep the final transcripts' skeletons next to the report; copy nothing else
    print(json.dumps({k: (v if not isinstance(v, dict) else list(v.keys())) for k, v in report.items() if k != "parent"}, indent=1)[:2000])
    world.remove()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--binary", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    run(a.binary, a.out)
