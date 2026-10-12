#!/usr/bin/env python3
"""CT-COMPAT-002: chat-toc installed through a marketplace, in a real host.

    $PY ct_marketplace.py --host 2.1.287 [--host current] [--source local|github] [--out DIR]

In the harness's isolated, logged-out world (no --plugin-dir for chat-toc):

  1. `claude plugin marketplace add <source>`: `local` is this repository's
     directory (the pre-release smoke: a directory marketplace runs the
     source folder itself), `github` is lkangd/cc-mods (the post-release
     install-level check: the host clones it and copies the plugin into its
     cache);
  2. `claude plugin install chat-toc@cc-mods`;
  3. `claude plugin list`: chat-toc@cc-mods, version from plugin.json, enabled;
  4. a fullscreen session resumed on a synthetic transcript: the Pane docks
     by itself; one click on a prompt's user side puts that prompt in view.

No model call. One run.jsonl record per host, with every command's output.
"""
import argparse
import json
import pathlib
import re
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import pty_harness as h  # noqa: E402
import toc_verifier as v  # noqa: E402

PLUGIN = HERE.parent.parent
REPOSITORY = PLUGIN.parent.parent
SOURCES = {"local": str(REPOSITORY), "github": "lkangd/cc-mods"}
VERSION = json.loads((PLUGIN / ".claude-plugin" / "plugin.json").read_text())["version"]


def cli(host, world, *args, timeout=300):
    out = subprocess.run([host.binary, *args], cwd=world.project, env=world.environment(),
                         capture_output=True, text=True, timeout=timeout)
    return {"argv": ["claude", *args], "exit": out.returncode, "output": (out.stdout + out.stderr).strip()}


def listed_plugin(text):
    """The `plugin list` block for chat-toc@cc-mods: its version and status."""
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if "chat-toc@cc-mods" in line:
            block = "\n".join(lines[i:i + 6])
            version = re.search(r"[Vv]ersion:?\s*([0-9][0-9.]*)", block)
            enabled = re.search(r"\b(enabled|disabled)\b", block, re.I)
            return {"version": version.group(1) if version else None,
                    "status": enabled.group(1).lower() if enabled else None}
    return None


def smoke(host, run, source):
    world = h.World(token="")
    actual, ev, t = {"source": SOURCES[source] if source == "github" else "<repo>"}, [], None
    try:
        steps = [cli(host, world, "plugin", "marketplace", "add", SOURCES[source]),
                 cli(host, world, "plugin", "install", "chat-toc@cc-mods"),
                 cli(host, world, "plugin", "list")]
        commands = run.dir / f"commands-{source}-{host.version}.txt"
        commands.write_text("\n\n".join(f"$ {' '.join(s['argv'])}\n(exit {s['exit']})\n{s['output']}" for s in steps)
                            .replace(str(world.base), "<tmp>").replace(str(REPOSITORY), "<repo>") + "\n")
        ev.append(commands)
        actual["exits"] = [s["exit"] for s in steps]
        actual["listed"] = listed_plugin(steps[2]["output"])
        cached = sorted(str(p.relative_to(world.config)) for p in (world.config / "plugins").rglob("plugin.json")
                        if "chat-toc" in str(p))
        actual["installedManifests"] = cached

        fx = world.fixture("turns", turns=12, version=host.version)
        log = run.dir / f"debug-{source}-{host.version}.log"
        t = h.launch(world, host, [], ["--resume", fx["session"], "--debug-file", str(log)], run=run)
        t.wait_for(lambda term: (p := v.parse_pane(term.rows())) is not None and p.entries,
                   "the Pane to dock by itself", timeout=40)
        t.settle()
        ev.append(t.snap(f"{source} {host.version} docked by itself"))
        text = log.read_text(errors="replace")
        actual["loadedAs"] = sorted(set(re.findall(r"hooks module (chat-toc@[\w-]+)", text)))
        actual["openedUnasked"] = bool(re.search(r"ui\.open chat-toc chat-toc \(unasked[^)]*\): placed", text))
        top = h.pane_to_top(t)
        target = next(e for e in top.entries if e.user_text.startswith("T0000"))
        t.click(top.left + 4, target.row + 1)
        rows = t.settle(quiet=1.0)
        ev.append(t.snap(f"{source} {host.version} after clicking T0000"))
        actual["clickJumped"] = "T0000 用户问题" in "\n".join(h.transcript_text(rows, top.left).splitlines()[:6])
        # the debug log names the world's paths; keep only chat-toc's lines
        kept = run.dir / f"debug-{source}-{host.version}-chat-toc-lines.log"
        kept.write_text("\n".join(line.replace(str(world.base), "<tmp>") for line in text.splitlines()
                                  if "chat-toc" in line) + "\n")
        log.unlink()
        ev.append(kept)
    except (h.ScenarioFailure, StopIteration, subprocess.TimeoutExpired) as failure:
        actual["failure"] = repr(failure)
    finally:
        if t is not None:
            t.close()
        world.remove()
    ok = (actual.get("exits") == [0, 0, 0] and actual.get("listed") == {"version": VERSION, "status": "enabled"}
          and actual.get("loadedAs") == ["chat-toc@cc-mods"] and actual.get("openedUnasked") is True
          and actual.get("clickJumped") is True)
    run.record("CT-COMPAT-002", host=host.version, plugin=f"chat-toc@cc-mods ({source} marketplace)", fixture="turns 12",
               expected=f"marketplace add + install succeed; plugin list shows chat-toc@cc-mods {VERSION} enabled; the "
                        "Pane (loaded as chat-toc@cc-mods, no --plugin-dir) docks by itself; a click on T0000's user "
                        "side puts that prompt at the top",
               actual=actual, result="pass" if ok else "fail", evidence=ev)
    return ok


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", action="append", default=None)
    parser.add_argument("--source", choices=tuple(SOURCES), default="local")
    parser.add_argument("--out", type=pathlib.Path)
    args = parser.parse_args()
    ok = True
    run = h.Run(args.out, f"marketplace-{args.source}")
    for version in args.host or ["2.1.287", "current"]:
        host = h.Host(version)
        passed = smoke(host, run, args.source)
        print(f"CT-COMPAT-002 {args.source} {host.version}: {'pass' if passed else 'fail'}", flush=True)
        ok = ok and passed
    print("run directory:", run.dir)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
