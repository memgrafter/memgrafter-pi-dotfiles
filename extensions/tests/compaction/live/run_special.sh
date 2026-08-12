#!/bin/bash
# Run the special-path compaction tests (threshold, escabort by default; overflow skipped
# per decision: overflow UX is abort + user figures it out). Usage: run_special.sh [scenarios...]
set -u

SCENARIOS="${*:-threshold escabort}"

HARNESS="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HARNESS/../../../.." && pwd)"
EXT="$REPO/extensions/pi-compaction-modes.ts"
SESSION=comp-test
PI_CMD="pi --provider deepseek --model deepseek-v4-flash --thinking off -a --session-dir"

mkdir -p "$HARNESS/runs/threshold" "$HARNESS/runs/threshold/.pi" "$HARNESS/runs/threshold/sessions"
mkdir -p "$HARNESS/runs/overflow" "$HARNESS/runs/overflow/.pi" "$HARNESS/runs/overflow/sessions"
mkdir -p "$HARNESS/runs/escabort" "$HARNESS/runs/escabort/.pi" "$HARNESS/runs/escabort/sessions"

# threshold: reserveTokens 240000 -> compact when context > 16k tokens (auto-trigger)
printf '{\n  "pi-compaction-modes": { "mode": "cached-handoff-tooltraces" },\n  "compaction": { "reserveTokens": 240000 }\n}\n' > "$HARNESS/runs/threshold/.pi/settings.json"
printf '{\n  "pi-compaction-modes": { "mode": "cached" }\n}\n' > "$HARNESS/runs/overflow/.pi/settings.json"
printf '{\n  "pi-compaction-modes": { "mode": "cached" }\n}\n' > "$HARNESS/runs/escabort/.pi/settings.json"

# filler files (33k and ~260k tokens)
python3 - <<PY
open("$HARNESS/runs/context_filler.txt", "w").write("This is context filler text for the compaction test. " * 2500)
open("$HARNESS/runs/overflow_filler.txt", "w").write("Overflow filler context. " * 42000)
PY

for s in threshold overflow escabort; do
  rm -f "$HARNESS/runs/$s/sessions"/*.jsonl "$HARNESS/runs/$s/driver.log" "$HARNESS/runs/$s/driver.out"
done

win=10
for s in $SCENARIOS; do
  tmux new-window -t $SESSION:$win -c "$HARNESS/runs/$s" -n "$s"
  tmux send-keys -t $SESSION:$win "$PI_CMD $HARNESS/runs/$s/sessions --extension $EXT"
  sleep 1
  tmux send-keys -t $SESSION:$win Enter
  booted=0
  for i in $(seq 1 20); do
    sleep 3
    if tmux capture-pane -t $SESSION:$win -p | grep -q "frag: coding-agent"; then booted=1; break; fi
    if tmux capture-pane -t $SESSION:$win -p | grep -q "pi --provider"; then
      tmux send-keys -t $SESSION:$win Enter
    fi
  done
  if [ "$booted" != "1" ]; then echo "WARNING: window $win ($s) did not boot"; fi
  win=$((win+1))
done

# Run special tests in parallel
nohup python3 "$HARNESS/drive_special.py" threshold 10 > "$HARNESS/runs/threshold/driver.out" 2>&1 &
nohup python3 "$HARNESS/drive_special.py" overflow 11 > "$HARNESS/runs/overflow/driver.out" 2>&1 &
nohup python3 "$HARNESS/drive_special.py" escabort 12 > "$HARNESS/runs/escabort/driver.out" 2>&1 &
echo "special drivers launched (windows 10-12)"
