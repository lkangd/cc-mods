"""The release verdict: which scenarios the contract requires, what counts as
their evidence, how a run's results settle each one, and the marker scan that
keeps prompt text out of everything the run leaves behind.

No processes run here: release_evidence.py runs the gates and the PTY
scenarios and feeds their results in; only scan_tree reads files."""
import json
import os
import pathlib
import re
import secrets as random_source

# Issue 05's stable scenario IDs. A manifest that drops one leaves it missing.
_FAMILIES = (
    ("PT-COMPAT", 5), ("PT-CAPTURE", 8), ("PT-LIFE", 4), ("PT-BRANCH", 4), ("PT-JUMP", 2),
    ("PT-UI", 8), ("PT-STORE", 9), ("PT-FAIL", 6), ("PT-CONTROL", 2), ("PT-DELETE", 4),
    ("PT-SEC", 4),
)
REQUIRED_SCENARIOS = [
    f"{family}-{number:03d}" for family, count in _FAMILIES for number in range(1, count + 1)
]

# Evidence that depends on the host is taken on every host version the release
# names; the rest is the same whichever host runs it.
PER_VERSION_KINDS = {"plugin", "pty", "validate"}
KINDS = PER_VERSION_KINDS | {"unit", "gate"}

# A scenario's outcome is the worst of its evidence.
_RANK = {"pass": 0, "skipped": 1, "missing": 2, "failed": 3}
_EVIDENCE_OUTCOME = {"pass": "pass", "skip": "skipped", "missing": "missing", "fail": "failed"}


class Results:
    """What one run settled, keyed by evidence kind, reference and host version."""

    def __init__(self) -> None:
        self._items: dict[tuple, dict] = {}

    def record(
        self, kind: str, ref: str, version: str | None, outcome: str,
        actual: str | None = None, link: str | None = None,
    ) -> None:
        if kind not in KINDS or outcome not in ("pass", "fail", "skip"):
            raise ValueError(f"unknown evidence {kind}/{outcome}")
        self._items[(kind, ref, version)] = {"outcome": outcome, "actual": actual, "link": link}

    def get(self, kind: str, ref: str, version: str | None) -> dict:
        return self._items.get(
            (kind, ref, version), {"outcome": "missing", "actual": None, "link": None}
        )


_PLUGIN_FILE = re.compile(r"^(tests/\S+\.test\.tsx?):$")
_PLUGIN_TEST = re.compile(r"^\((pass|fail|skip|todo)\) (.+?)(?: \[[0-9.]+m?s\])?$")


def parse_plugin_test_output(output: str) -> dict[str, str]:
    """`claude plugin test` output, as {"file::title": pass|fail|skip}. A title
    met twice in one file cannot be told apart, so it counts as failed."""
    results: dict[str, str] = {}
    current = None
    for line in output.splitlines():
        header = _PLUGIN_FILE.match(line)
        if header:
            current = header.group(1)
            continue
        test = _PLUGIN_TEST.match(line)
        if not test or current is None:
            continue
        key = f"{current}::{test.group(2)}"
        outcome = {"pass": "pass", "fail": "fail"}.get(test.group(1), "skip")
        results[key] = "fail" if key in results else outcome
    return results


def judge_scenario(item: dict, results: Results, versions: list[str]) -> dict:
    rows = []
    for ref in item["evidence"]:
        for version in versions if ref["kind"] in PER_VERSION_KINDS else [None]:
            got = results.get(ref["kind"], ref["ref"], version)
            rows.append({
                "kind": ref["kind"],
                "ref": ref["ref"],
                "version": version,
                "outcome": _EVIDENCE_OUTCOME[got["outcome"]],
                "actual": got["actual"],
                "link": got["link"],
            })
    covered = {row["kind"] for row in rows}
    bare_layers = [layer for layer in item["layers"] if layer not in covered]
    outcome = max((row["outcome"] for row in rows), key=_RANK.__getitem__, default="missing")
    if bare_layers and _RANK[outcome] < _RANK["missing"]:
        outcome = "missing"
    tally: dict[str, int] = {}
    for row in rows:
        tally[row["outcome"]] = tally.get(row["outcome"], 0) + 1
    actual = [", ".join(f"{count} {name}" for name, count in sorted(tally.items())) or "no evidence"]
    if bare_layers:
        actual.append(f"no evidence for layer {', '.join(bare_layers)}")
    actual += [
        f"{row['version']}: {row['actual']}" if row["version"] else row["actual"]
        for row in rows if row["actual"]
    ]
    return {
        "id": item["id"],
        "title": item["title"],
        "steps": item["steps"],
        "expected": item["expected"],
        "layers": item["layers"],
        "evidence": rows,
        "actual": "; ".join(actual),
        "outcome": outcome,
    }


def judge_report(
    manifest: dict, results: Results, *, versions: list[str], partial: bool,
    tree_clean: bool, leaks: list[dict], gates: list[dict],
) -> dict:
    listed = {item["id"]: item for item in manifest["scenarios"]}
    reasons = []
    ids = [item["id"] for item in manifest["scenarios"]]
    repeated = sorted({id_ for id_ in ids if ids.count(id_) > 1})
    if repeated:
        reasons.append(f"scenarios listed more than once: {', '.join(repeated)}")
    scenarios = []
    for id_ in REQUIRED_SCENARIOS:
        if id_ in listed:
            scenarios.append(judge_scenario(listed[id_], results, versions))
        else:
            scenarios.append({
                "id": id_, "title": "", "steps": [], "expected": "", "layers": [],
                "evidence": [], "actual": "not in the scenario manifest", "outcome": "missing",
            })
    unknown = sorted(set(listed) - set(REQUIRED_SCENARIOS))
    if unknown:
        reasons.append(f"scenarios the contract does not name: {', '.join(unknown)}")
    counts = {name: 0 for name in _RANK}
    for verdict in scenarios:
        counts[verdict["outcome"]] += 1
    for name in ("failed", "missing", "skipped"):
        if counts[name]:
            reasons.append(f"{counts[name]} scenario(s) {name}")
    if partial:
        reasons.append("partial run: not every scenario was run")
    if not tree_clean:
        reasons.append("the working tree differs from the recorded commit")
    if leaks:
        reasons.append(f"{len(leaks)} leak(s) of a marker or secret")
    reasons += [f"gate {gate['name']} {gate['outcome']}" for gate in gates if gate["outcome"] != "pass"]
    return {
        "formatVersion": 1,
        "overall": "fail" if reasons else "pass",
        "reasons": reasons,
        "partial": partial,
        "versions": versions,
        "counts": counts,
        "gates": gates,
        "leaks": leaks,
        "scenarios": scenarios,
    }


# What the host shows when its own requests to the API fail. A PTY scenario
# that failed with one of these on screen is run once more (Issue 31 comments).
_NETWORK_FAILURE = re.compile(r"Connection dropped|API Error|ECONNRESET|ETIMEDOUT|Unable to connect to API")


def network_failure(trace: str) -> bool:
    return bool(_NETWORK_FAILURE.search(trace))


def new_marker(scenario_id: str) -> str:
    """128 random bits first, so a row the UI cuts short still carries them."""
    return f"{random_source.token_hex(16)}-{scenario_id}"


# The shortest cut of a marker's random part that still counts as the marker.
MARKER_PREFIX = 12


class Scanner:
    """Finds markers, whole or cut to at least MARKER_PREFIX characters of their
    random part, and secrets (whole only), and masks them in screen rows."""

    def __init__(self, markers: list[str], secrets: list[str]) -> None:
        self.markers: list[str] = []
        self.secrets = [secret for secret in secrets if secret]
        self._needles: list[bytes] = []
        self._patterns: list[tuple[int, re.Pattern]] = []
        self._secret_patterns = [re.compile(re.escape(secret)) for secret in self.secrets]
        for marker in markers:
            self.add(marker)

    def add(self, marker: str) -> None:
        """A marker made after the scanner, as each scenario draws its own."""
        index = len(self.markers)
        self.markers.append(marker)
        self._needles.append(marker[:MARKER_PREFIX].encode())
        # The random part, then as much of the rest of the marker as is there.
        tail = ""
        for char in reversed(marker[MARKER_PREFIX:]):
            tail = f"(?:{re.escape(char)}{tail})?"
        self._patterns.append((index, re.compile(re.escape(marker[:MARKER_PREFIX]) + tail)))

    def find(self, data: bytes) -> list[str]:
        kinds = []
        if any(needle in data for needle in self._needles):
            kinds.append("marker")
        if any(secret.encode() in data for secret in self.secrets):
            kinds.append("secret")
        return kinds

    def redact_rows(self, rows: list[str], width: int | None = None) -> list[str]:
        """Masks every match in place, keeping each row's length. With `width`,
        rows that fill it are read as wrapping onto the next one."""
        joined = []
        spans = []
        cursor = 0
        for row in rows:
            spans.append((cursor, cursor + len(row)))
            joined.append(row)
            cursor += len(row)
            if width is None or len(row) < width:
                joined.append("\n")
                cursor += 1
        text = list("".join(joined))
        source = "".join(joined)
        for label, pattern in [(f"<marker:{i + 1}>", p) for i, p in self._patterns] + [
            ("<secret>", p) for p in self._secret_patterns
        ]:
            for match in pattern.finditer(source):
                start, end = match.span()
                mask = (label + "·" * (end - start))[: end - start]
                text[start:end] = list(mask)
        masked = "".join(text)
        return [masked[start:end] for start, end in spans]


# Files that may hold prompt text by design: the archive's own SQLite files
# (live, WAL, SHM, migration backups and quarantined copies), and the host's
# record of the conversation itself and of its background sessions, which
# Prompt Trail neither writes nor owns.
ALLOWED_RULES = [
    "archive SQLite files under a plugin data archives/ directory: "
    "<project>.sqlite3 with -wal, -shm, -journal and .pre-migration-vN[.partial] siblings, "
    "including quarantined copies",
    "Claude Code conversation records under the config directory: projects/, history.jsonl, "
    "file-history/, paste-cache/",
    "Claude Code background session records under the config directory: sessions/, daemon/, jobs/",
]
_ARCHIVE_FILE = re.compile(
    r"^[0-9a-f]{64}\.sqlite3(?:\.pre-migration-v[0-9]+(?:\.partial)?)?(?:-wal|-shm|-journal)?$"
)
_HOST_CONVERSATION_DIRS = {"projects", "file-history", "paste-cache", "sessions", "daemon", "jobs"}


def _allowed(relative: pathlib.PurePath, config: pathlib.PurePath) -> bool:
    """Whether a file may hold markers: only under the isolated config directory."""
    try:
        inside = relative.relative_to(config).parts
    except ValueError:
        return False
    if inside[:2] == ("plugins", "data") and len(inside) > 4 and inside[3] == "archives":
        return bool(_ARCHIVE_FILE.match(inside[-1]))
    return inside == ("history.jsonl",) or (len(inside) > 1 and inside[0] in _HOST_CONVERSATION_DIRS)


def scan_tree(base: pathlib.Path, scanner: Scanner, config: str) -> dict:
    """Every file under `base` and every name there, markers allowed only in the
    files ALLOWED_RULES names under `config` (relative to `base`); secrets are
    allowed nowhere. What cannot be read counts as a leak, never as clean."""
    config_path = pathlib.PurePath(config)
    leaks = []
    scanned = 0
    allowed = 0

    def leak(relative: pathlib.PurePath, kind: str) -> None:
        leaks.append({"path": scanner.redact_rows([str(relative)])[0], "kind": kind})

    def unreadable(error: OSError) -> None:
        leak(pathlib.Path(error.filename).relative_to(base), "unscannable")

    for directory, subdirectories, names in os.walk(base, onerror=unreadable):
        for name in subdirectories + names:
            path = pathlib.Path(directory) / name
            relative = path.relative_to(base)
            for kind in scanner.find(name.encode()):
                leak(relative, kind)
            if path.is_symlink():
                for kind in scanner.find(os.readlink(path).encode()):
                    leak(relative, f"{kind} in link target")
        for name in names:
            path = pathlib.Path(directory) / name
            relative = path.relative_to(base)
            if path.is_symlink() or not path.is_file():
                continue
            try:
                data = path.read_bytes()
            except OSError:
                leak(relative, "unscannable")
                continue
            kinds = scanner.find(data)
            if _allowed(relative, config_path):
                allowed += 1
                kinds = [kind for kind in kinds if kind == "secret"]
            else:
                scanned += 1
            for kind in kinds:
                leak(relative, kind)
    return {"scannedFiles": scanned, "allowedFiles": allowed, "leaks": leaks}


def render_markdown(report: dict) -> str:
    lines = [
        "# Prompt Trail release evidence",
        "",
        f"**Overall: {report['overall']}**",
        "",
    ]
    lines += [f"- {reason}" for reason in report["reasons"]] or ["- zero failed, missing, skipped or leaked"]
    lines += ["", "## Identity", ""]
    lines += [f"- {key}: `{value}`" for key, value in report.get("identity", {}).items()]
    lines += ["", "## Gates", ""]
    lines += [
        f"- {gate['name']}: {gate['outcome']}" + (f" ([log]({gate['link']}))" if gate.get("link") else "")
        for gate in report["gates"]
    ] or ["- none run"]
    if report.get("benchmark"):
        lines += ["", "## 100k benchmark", "", "```json", _json(report["benchmark"]), "```"]
    privacy = report.get("privacy")
    if privacy:
        lines += [
            "", "## Privacy scan", "",
            f"- scanned files: {privacy['scannedFiles']}; allowed files: {privacy['allowedFiles']}",
            f"- argv samples: {privacy.get('argvSamples', 0)}",
            "- allowed by design:",
        ]
        lines += [f"  - {rule}" for rule in privacy["allowedRules"]]
    lines += ["", "## Leaks", ""]
    lines += [f"- {leak['kind']} in `{leak['path']}`" for leak in report["leaks"]] or ["- none"]
    counts = report["counts"]
    lines += [
        "", "## Scenarios", "",
        f"{counts['pass']} pass · {counts['failed']} failed · {counts['missing']} missing · "
        f"{counts['skipped']} skipped",
        "",
        "| ID | Result | Actual |",
        "| --- | --- | --- |",
    ]
    lines += [
        f"| {s['id']} | {s['outcome']} | {s['actual'].replace('|', '/')} |"
        for s in report["scenarios"]
    ]
    for s in report["scenarios"]:
        lines += ["", f"### {s['id']} {s['title']}", "", f"Result: **{s['outcome']}**", ""]
        lines += ["Steps:"] + [f"1. {step}" for step in s["steps"]]
        lines += ["", f"Expected: {s['expected']}", "", f"Actual: {s['actual']}", "", "Evidence:"]
        lines += [
            f"- {row['kind']} `{row['ref']}`"
            + (f" on {row['version']}" if row["version"] else "")
            + f": {row['outcome']}"
            + (f" ([trace]({row['link']}))" if row["link"] else "")
            for row in s["evidence"]
        ] or ["- none"]
    return "\n".join(lines) + "\n"


def _json(value) -> str:
    return json.dumps(value, indent=2, ensure_ascii=False)
