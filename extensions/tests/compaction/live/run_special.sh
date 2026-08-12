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

# Kill stale drivers from previous runs targeting the same windows
pkill -f "drive_special.py" 2>/dev/null
pkill -f "$HARNESS/drive_special.py" 2>/dev/null
sleep 1

# Ensure the tmux session exists (run.sh normally creates it)
if ! tmux has-session -t $SESSION 2>/dev/null; then
  tmux new-session -d -s $SESSION -c /tmp -n launch
  echo "created tmux session $SESSION"
fi

seed_mode() { # seed_mode <scenario>
  local s="$1" mode="cached"
  case "$s" in
    threshold) mode="cached-handoff-tooltraces" ;;
    modearg-reverse) mode="cached-handoff-tooltraces" ;;
  esac
  mkdir -p "$HARNESS/runs/$s/.pi" "$HARNESS/runs/$s/sessions"
  if [ "$s" = threshold ]; then
    # reserveTokens 240000 -> compact when context > 16k tokens (auto-trigger)
    printf '{\n  "pi-compaction-modes": { "mode": "%s" },\n  "compaction": { "reserveTokens": 240000 }\n}\n' "$mode" > "$HARNESS/runs/$s/.pi/settings.json"
  else
    printf '{\n  "pi-compaction-modes": { "mode": "%s" }\n}\n' "$mode" > "$HARNESS/runs/$s/.pi/settings.json"
  fi
}

for s in $SCENARIOS; do seed_mode "$s"; done

# filler files (33k and ~260k tokens)
python3 - <<PY
open("$HARNESS/runs/context_filler.txt", "w").write("This is context filler text for the compaction test. " * 2500)
open("$HARNESS/runs/overflow_filler.txt", "w").write("Overflow filler context. " * 42000)
PY

for s in $SCENARIOS; do
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
win=10
for s in $SCENARIOS; do
  nohup python3 "$HARNESS/drive_special.py" "$s" "$win" > "$HARNESS/runs/$s/driver.out" 2>&1 &
  win=$((win+1))
done
echo "special drivers launched for: $SCENARIOS"
