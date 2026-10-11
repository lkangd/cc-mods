"""check_screens.py <screens dir>...: each capture's filter row names the Layout and filter its file says, and the
pane is the width its directory says (pane left edge = 170 - width)."""
import pathlib, re, sys, unicodedata

NAMES = {"card": "卡片", "compact": "紧凑", "timeline": "时间轴"}
FILTERS = {"": "●全部", "user": "●用户", "agent": "●Agent"}


def cells(text):
    return sum(2 if unicodedata.east_asian_width(c) in ("W", "F") else 1 for c in text)


bad = 0
for folder in map(pathlib.Path, sys.argv[1:]):
    width = int(folder.name.split("-")[-1])
    for screen in sorted(folder.glob("screens/*.txt")):
        m = re.match(r"\d+-w\d+-(card|compact|timeline)(?:-(user|agent))?", screen.stem)
        layout, filt = m.group(1), m.group(2) or ""
        rows = screen.read_text(encoding="utf-8").split("\n")[1:]
        head = next((r for r in rows if "1: " in r and "全部" in r), "")
        label_row = "".join(r for r in rows[:4])
        border = cells(head[: head.find("1: ")]) if head else -1
        ok = f"布局:{NAMES[layout]}" in label_row and FILTERS[filt] in head and border == 170 - width
        bad += not ok
        print("ok " if ok else "BAD", screen.relative_to(folder.parent), "pane left", border)
sys.exit(1 if bad else 0)
