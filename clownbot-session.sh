#!/bin/bash
# bootstrap the clownbot tmux session if it doesn't exist, then attach
SESSION=clownbot
DIR=/home/clownbot/plan1

# clean up stale socket if server is gone
if [ -S "$TMUX_TMPDIR/default" ] || [ -S "/tmp/tmux-$(id -u)/default" ]; then
  tmux start-server 2>/dev/null || rm -f "/tmp/tmux-$(id -u)/default" 2>/dev/null
fi

if ! tmux has-session -t "$SESSION" 2>/dev/null; then
  # window 0: shell — for vim, bash, general ops
  tmux new-session -d -s "$SESSION" -n shell -c "$DIR"

  # window 1: claude — kill and re-run 'claude' to restart
  tmux new-window -t "$SESSION" -n claude -c "$DIR"
  tmux send-keys -t "${SESSION}:claude" "claude" Enter

  # land on claude window by default
  tmux select-window -t "${SESSION}:claude"
fi

exec tmux attach-session -t "${SESSION}:claude"
