#!/bin/zsh
set -e

cd "$(dirname "$0")/../../../.."

unset CLAUDECODE
unset CLAUDE_CODE_CHILD_SESSION
unset CLAUDE_CODE_ENTRYPOINT
unset CLAUDE_CODE_EXECPATH
unset CLAUDE_CODE_MESSAGING_SOCKET
unset CLAUDE_CODE_MESSAGING_TOKEN
unset CLAUDE_CODE_SESSION_ATTENDED
unset CLAUDE_CODE_SESSION_ID
unset CLAUDE_PID
export CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1

npx -y @anthropic-ai/claude-code@2.1.273 \
  --plugin-dir .scratch/prompt-history/prototypes/scrollable-timeline/plugin

status=$?
printf '\nprompt-history 原型会话已退出（status=%s）。\n' "$status"
read '?按 Return 关闭此窗口。'
exit "$status"
