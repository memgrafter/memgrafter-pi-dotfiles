#!/bin/bash
# Launch 8 parallel drivers. Usage: run_batch.sh
MODES="cached cached-agentic cached-agentic-tooltraces cached-handoff cached-handoff-tooltraces cached-summary-tooltraces programmatic vanilla"
BASE=~/pi-compact-test
rm -f "$BASE/driver_pids.txt"
win=2
for m in $MODES; do
  tmux respawn-pane -t comp-test:$win -k
  sleep 2
  tmux send-keys -t comp-test:$win "pi --provider deepseek --model deepseek-v4-flash --thinking off -a --session-dir $BASE/$m/sessions --extension /Users/trentrobbins/code/memgrafter-pi-dotfiles/extensions/pi-compaction-modes.ts"
  sleep 1
  tmux send-keys -t comp-test:$win Enter
  rm -f "$BASE/$m/sessions/"*.jsonl "$BASE/$m/driver.log"
  nohup python3 "$BASE/drive.py" "$m" "$win" > "$BASE/$m/driver.out" 2>&1 &
  echo "$!" >> "$BASE/driver_pids.txt"
  win=$((win+1))
  sleep 2
done
echo "launched pids: $(cat $BASE/driver_pids.txt | tr '\n' ' ')"
