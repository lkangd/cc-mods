---
runner: ccsp -g gpt-5.6-luna claude
concurrency: 0   # 0 = unlimited: all reviewers dispatched at once
max_rounds: 3
backlog_dir: docs/code-review-backlog
---

Configuration for the code-review plugin. Edit values above or re-run /code-review:setup.
