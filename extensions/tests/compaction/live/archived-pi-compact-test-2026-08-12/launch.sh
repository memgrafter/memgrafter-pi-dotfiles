#!/bin/bash
# Launch 8 pi test windows in tmux session comp-test, one per compaction mode.
set -u
MODES="cached cached-agentic cached-agentic-tooltraces cached-handoff cached-handoff-tooltraces cached-summary-tooltraces programmatic vanilla"
BASE=~/pi-compact-test
EXT=/Users/trentrobbins/code/memgrafter-pi-dotfiles/extensions/pi-compaction-modes.ts

tmux kill-session -t comp-test 2>/dev/null
tmux new-session -d -s comp-test -c "$BASE" -n launch
win=2
for m in $MODES; do
  tmux new-window -t comp-test:$win -c "$BASE/$m" -n "$m"
  tmux send-keys -t comp-test:$win "pi --provider deepseek --model deepseek-v4-flash --thinking off -a --session-dir $BASE/$m/sessions --extension $EXT"
  sleep 1
  tmux send-keys -t comp-test:$win Enter
  win=$((win+1))
  sleep 2
done
echo "launched; windows:"
tmux list-windows -t comp-test -F '#{window_index} #{window_name}'
