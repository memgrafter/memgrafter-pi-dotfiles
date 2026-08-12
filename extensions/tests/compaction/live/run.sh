#!/bin/bash
# Run the compaction-mode live test matrix in tmux.
# One pi session per mode (8 total), driven in parallel by drive.py.
set -u

HARNESS="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HARNESS/../../../.." && pwd)"
EXT="$REPO/extensions/pi-compaction-modes.ts"
SESSION=comp-test
MODES="cached cached-agentic cached-agentic-tooltraces cached-handoff cached-handoff-tooltraces cached-summary-tooltraces programmatic vanilla"
PI_CMD="pi --provider deepseek --model deepseek-v4-flash --thinking off -a --session-dir"

# Prepare run dirs + seeded project settings (mode is read per-session from cwd)
mkdir -p "$HARNESS/runs"
for m in $MODES; do
  mkdir -p "$HARNESS/runs/$m/sessions" "$HARNESS/runs/$m/.pi"
  printf '{\n  "pi-compaction-modes": { "mode": "%s" }\n}\n' "$m" > "$HARNESS/runs/$m/.pi/settings.json"
  rm -f "$HARNESS/runs/$m/sessions"/*.jsonl "$HARNESS/runs/$m/driver.log" "$HARNESS/runs/$m/driver.out"
done

# Filler context (~33k tokens) so sessions exceed keepRecentTokens
python3 - <<PY
open("$HARNESS/runs/context_filler.txt", "w").write("This is context filler text for the compaction test. " * 2500)
PY

tmux kill-session -t $SESSION 2>/dev/null
tmux new-session -d -s $SESSION -c /tmp -n launch

win=2
PIDS=""
for m in $MODES; do
  tmux new-window -t $SESSION:$win -c "$HARNESS/runs/$m" -n "$m"
  tmux send-keys -t $SESSION:$win "$PI_CMD $HARNESS/runs/$m/sessions --extension $EXT"
  sleep 1
  tmux send-keys -t $SESSION:$win Enter
  # Poll for boot; re-send Enter if the command is still sitting at the prompt
  booted=0
  for i in $(seq 1 20); do
    sleep 3
    if tmux capture-pane -t $SESSION:$win -p | grep -q "frag: coding-agent"; then booted=1; break; fi
    if tmux capture-pane -t $SESSION:$win -p | grep -q "pi --provider"; then
      tmux send-keys -t $SESSION:$win Enter
    fi
  done
  if [ "$booted" != "1" ]; then echo "WARNING: window $win ($m) did not boot"; fi
  win=$((win+1))
done

# Launch drivers in parallel
win=2
for m in $MODES; do
  nohup python3 "$HARNESS/drive.py" "$m" "$win" > "$HARNESS/runs/$m/driver.out" 2>&1 &
  PIDS="$PIDS $!"
  win=$((win+1))
done
echo "driver pids:$PIDS"
echo "monitor: tail -f $HARNESS/runs/*/driver.out"
