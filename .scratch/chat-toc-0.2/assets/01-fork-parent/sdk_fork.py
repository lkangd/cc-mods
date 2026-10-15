#!/usr/bin/env python3
"""The Agent SDK's forkSession(), on the synthetic parent (no model call; it copies a file).
Prints the new file's structure: which rows, whether pre-compaction rows come along,
what the rows say about their origin. Usage: sdk_fork.py <sdk-install-dir> <node>"""
import json
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import fork_experiment as X  # noqa: E402

sdk_dir, node = sys.argv[1], sys.argv[2]
host = X.Host("/Users/liangkangda/.local/bin/claude")
world = X.H.World()
parent = X.build_parent(world, host)
script = f"""
import {{ forkSession }} from '{sdk_dir}/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs'
const r = await forkSession('{X.P_ID}', {{ dir: '{world.project}' }})
console.log(JSON.stringify(r))
"""
(world.base / "fork.mjs").write_text(script)
out = subprocess.run([node, str(world.base / "fork.mjs")], capture_output=True, text=True,
                     env={"PATH": "/usr/bin:/bin:/opt/homebrew/bin", "CLAUDE_CONFIG_DIR": str(world.config), "HOME": str(world.home)})
print("exit", out.returncode, out.stdout.strip()[:200], out.stderr.strip()[:300])
files = X.project_files(world)
new = [k for k in files if k != X.P_ID]
print("new files", [k[:8] for k in new])
if new:
    rows = X.read_rows(files[new[0]])
    p_rows = X.read_rows(parent["path"])
    pu = {r["uuid"] for r in p_rows if r.get("uuid")}
    print("rows", len(rows), "P rows", len(p_rows))
    print("types", [(r.get("type"), r.get("subtype")) for r in rows])
    print("uuids shared with P:", sum(1 for r in rows if r.get("uuid") in pu), "of", sum(1 for r in rows if r.get("uuid")))
    print("compact_boundary rows:", sum(1 for r in rows if r.get("subtype") == "compact_boundary"))
    print("key sets (distinct):", {tuple(sorted(r.keys())) for r in rows if r.get("type") in ("user", "assistant")})
    ff = [r["forkedFrom"] for r in rows if "forkedFrom" in r]
    print("forkedFrom on", len(ff), "rows; shapes", {tuple(sorted(f)) for f in ff}, "; names P:",
          {f.get("sessionId") == X.P_ID for f in ff}, "; messageUuid in P:", sum(1 for f in ff if f.get("messageUuid") in pu))
    b = next(r for r in rows if r.get("subtype") == "compact_boundary")
    print("boundary: parentUuid", b["parentUuid"], "logicalParentUuid in new file:", b.get("logicalParentUuid") in {r.get("uuid") for r in rows},
          "in P:", b.get("logicalParentUuid") in pu)
    print("any field naming P:", any(X.P_ID in json.dumps(r) for r in rows))
world.remove()
