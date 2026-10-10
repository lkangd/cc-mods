#!/bin/sh
# cmd.sh '/slash args' [wait] : submit a slash command in the PTY, then print the pane side of the screen
H=$(dirname "$0")
$H/c.sh "{\"op\":\"type\",\"text\":\"$1\"}" >/dev/null; sleep 0.6
$H/c.sh '{"op":"key","names":["enter"]}' >/dev/null; sleep ${2:-2}
$H/scr.sh
