#!/usr/bin/env python3
"""Drive special-path compaction tests: threshold, overflow, escabort.

Usage: drive_special.py <scenario> <win>
"""
import json
import os
import subprocess
import sys
import time
import glob

SCENARIO = sys.argv[1]
WIN = sys.argv[2]
HARNESS = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.join(HARNESS, "runs", SCENARIO)
SESS_DIR = os.path.join(BASE, "sessions")
LOG = os.path.join(BASE, "driver.log")
TARGET = f"comp-test:{WIN}"
FILLER = os.path.join(HARNESS, "runs", "context_filler.txt")
OVERFLOW_FILLER = os.path.join(HARNESS, "runs", "overflow_filler.txt")

DANCE_PROMPTS = [
    "Reply with ONLY a standalone structured summary of the context so far",
    "Produce only the agentic state needed to continue this coding session",
    "Write a handoff doc for a new agent to continue the session",
]


def sh(*args, timeout=30):
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout)


def log(msg):
    line = f"{time.strftime('%H:%M:%S')} [{SCENARIO}] {msg}"
    print(line, flush=True)
    with open(LOG, "a") as f:
        f.write(line + "\n")


def send(text, enter=True):
    sh("tmux", "send-keys", "-t", TARGET, text)
    time.sleep(0.4)
    if enter:
        sh("tmux", "send-keys", "-t", TARGET, "Enter")


def send_key(key):
    sh("tmux", "send-keys", "-t", TARGET, key)


def capture():
    return sh("tmux", "capture-pane", "-t", TARGET, "-p", "-S", "-80").stdout


def entries():
    out = []
    for f in sorted(glob.glob(os.path.join(SESS_DIR, "*.jsonl"))):
        try:
            with open(f) as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        out.append(json.loads(line))
                    except Exception:
                        pass
        except FileNotFoundError:
            pass
    return out


def assistant_msgs(es):
    return [e for e in es if e.get("type") == "message" and e.get("message", {}).get("role") == "assistant"]


def msg_text(m):
    c = m.get("content")
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return "".join(b.get("text", "") for b in c if isinstance(b, dict) and b.get("type") == "text")
    return ""


def last_assistant_text(es):
    for e in reversed(assistant_msgs(es)):
        t = msg_text(e["message"])
        if t:
            return t
    return ""


def compaction_entries(es):
    return [e for e in es if e.get("type") == "compaction"]


def wait_for(pred, timeout, what):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if pred(entries()):
            return
        time.sleep(3)
    log(f"TIMEOUT waiting for: {what}")
    log("--- last pane ---")
    log(capture())
    log("--- last entries ---")
    for e in entries()[-8:]:
        log(json.dumps(e, default=str)[:300])
    sys.exit(2)


def wait_boot(timeout=120):
    log("waiting for boot...")
    deadline = time.time() + timeout
    while time.time() < deadline:
        if "frag: coding-agent" in capture():
            break
        time.sleep(3)
    else:
        log("TIMEOUT waiting for pi boot")
        log(capture())
        sys.exit(2)
    time.sleep(4)
    log("booted")


def paste_file(bufname, path):
    sh("tmux", "load-buffer", "-b", bufname, path)
    time.sleep(0.5)
    sh("tmux", "paste-buffer", "-b", bufname, "-t", TARGET)


def wait_pane_text(needle, timeout, what):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if needle in capture():
            return True
        time.sleep(1)
    log(f"TIMEOUT waiting for pane text: {what} ({needle!r})")
    log("--- last pane ---")
    log(capture())
    return False


def scenario_threshold():
    log("=== threshold: paste filler, expect auto-compaction ===")
    wait_boot()
    send("Write a haiku about caching. Reply with only the haiku.")
    wait_for(lambda es: len(assistant_msgs(es)) >= 1, 240, "haiku reply")
    # one message: instruction + 33k-token filler pushes context past 16k threshold
    send("Read the following text and reply with exactly: FILLER_OK\n\n", enter=False)
    paste_file("thr", FILLER)
    time.sleep(2)
    send_key("Enter")
    log("sent filler paste; expecting threshold-triggered dance")
    wait_for(lambda es: len(compaction_entries(es)) >= 1, 420, "threshold compaction entry")
    ce = compaction_entries(entries())[-1]
    log(f"compaction entry found: mode={ce.get('details', {}).get('mode')!r} tokensBefore={ce.get('tokensBefore')}")
    send("Reply with exactly: POST_COMPACT_OK")
    wait_for(lambda es: "POST_COMPACT_OK" in last_assistant_text(es), 240, "POST_COMPACT_OK")
    log("=== THRESHOLD COMPLETE ===")


def scenario_overflow():
    log("=== overflow: accumulate >256k tokens in chunks, expect cancel + notify, no compaction ===")
    wait_boot()
    send("Write a haiku about caching. Reply with only the haiku.")
    wait_for(lambda es: len(assistant_msgs(es)) >= 1, 240, "haiku reply")
    # A single 1MB paste crashes the TUI editor, so grow context in proven-safe 132KB chunks.
    # Each chunk ~= 25k tokens; 12 chunks ~= 300k -> the 12th model call exceeds the 256k window.
    CHUNKS = 12
    for i in range(1, CHUNKS + 1):
        expected_assistants = 1 + i  # haiku + replies to chunks 1..i
        send(f"Chunk {i} of filler. Reply with exactly: CHUNK_OK\n\n", enter=False)
        paste_file("ovf", FILLER)
        time.sleep(2)
        send_key("Enter")
        log(f"sent filler chunk {i}/{CHUNKS}")
        wait_for(lambda es: len(assistant_msgs(es)) >= expected_assistants or len(compaction_entries(es)) >= 1, 240, f"chunk {i} reply or overflow")
        es = entries()
        if len(compaction_entries(es)) >= 1:
            log("unexpected compaction entry before overflow")
            break
        log(f"chunk {i} replied (assistant count {len(assistant_msgs(es))})")
    notify = wait_pane_text("Context overflow: compaction cancelled", 300, "overflow notify")
    log(f"overflow notify seen: {notify}")
    es = entries()
    log(f"compactions in session: {len(compaction_entries(es))}")
    log("=== OVERFLOW COMPLETE ===")


def scenario_escabort():
    log("=== escabort: /compact then Escape mid-summary, expect cancel + no compaction ===")
    wait_boot()
    send("Write a haiku about caching. Reply with only the haiku.")
    wait_for(lambda es: len(assistant_msgs(es)) >= 1, 240, "haiku reply")
    # Grow context with 4 filler pastes (~130k tokens) so the summary turn is
    # slow enough to abort mid-flight (a ~32k context completes in ~2.6s).
    for i in range(1, 5):
        send(f"Filler chunk {i}. Reply with exactly: CHUNK_OK\n\n", enter=False)
        paste_file("esc", FILLER)
        time.sleep(2)
        send_key("Enter")
        wait_for(lambda es: len(assistant_msgs(es)) >= 1 + i, 240, f"filler chunk {i} reply")
        log(f"filler chunk {i} replied")
    log("context loaded (~130k tokens)")
    send("/compact")
    log("sent /compact; waiting for injected message in pane (real-time)")
    ok = wait_pane_text("Reply with ONLY a standalone structured summary", 90, "injected message in pane")
    log(f"injected message seen in pane: {ok}")
    time.sleep(1)
    send_key("Escape")
    log("sent Escape mid-summary-turn")
    ok = wait_pane_text("Compaction summary cancelled", 60, "cancel notify")
    log(f"cancel notify seen: {ok}")
    es = entries()
    log(f"compactions in session: {len(compaction_entries(es))}")
    log("=== ESCABORT COMPLETE ===")


def scenario_modearg():
    """Configured mode cached, /compact cached-handoff-tooltraces.
    Before fix: phase 3 fell back to configured mode -> no tooltrace, details.mode=cached.
    """
    log("=== modearg: configured cached + /compact cached-handoff-tooltraces ===")
    wait_boot()
    send("Write a haiku about caching. Reply with only the haiku.")
    wait_for(lambda es: len(assistant_msgs(es)) >= 1, 240, "haiku reply")
    send(f"Run bash: ls -la {BASE}. Then reply with exactly DONE.")
    wait_for(lambda es: "DONE" in last_assistant_text(es).upper(), 240, "DONE")
    send("Read the following text and reply with exactly: FILLER_OK\n\n", enter=False)
    paste_file("ma", FILLER)
    time.sleep(2)
    send_key("Enter")
    wait_for(lambda es: "FILLER_OK" in last_assistant_text(es), 300, "FILLER_OK")
    send("/compact cached-handoff-tooltraces")
    log("sent /compact cached-handoff-tooltraces")
    wait_for(lambda es: len(compaction_entries(es)) >= 1, 300, "compaction entry")
    es = entries()
    ce = compaction_entries(es)[-1]
    d = ce.get("details", {})
    log(f"details.mode={d.get('mode')!r} (expect 'cached-handoff-tooltraces')")
    log(f"summary has Programmatic section: {'Programmatic' in ce.get('summary', '')} (expect True)")
    handoff_injected = [
        u for u in es
        if u.get("type") == "message" and u.get("message", {}).get("role") == "user"
        and msg_text(u.get("message", {})).startswith("Write a handoff doc")
    ]
    log(f"handoff prompt injected: {len(handoff_injected) == 1} (expect True)")
    send("Reply with exactly: POST_COMPACT_OK")
    wait_for(lambda es: "POST_COMPACT_OK" in last_assistant_text(es), 240, "POST_COMPACT_OK")
    log("=== MODEARG COMPLETE ===")


def scenario_modearg_reverse():
    """Configured cached-handoff-tooltraces, /compact cached.
    Before fix: phase 3 appended tooltrace + details.mode=cached-handoff-tooltraces.
    """
    log("=== modearg-reverse: configured cached-handoff-tooltraces + /compact cached ===")
    wait_boot()
    send("Write a haiku about caching. Reply with only the haiku.")
    wait_for(lambda es: len(assistant_msgs(es)) >= 1, 240, "haiku reply")
    send(f"Run bash: ls -la {BASE}. Then reply with exactly DONE.")
    wait_for(lambda es: "DONE" in last_assistant_text(es).upper(), 240, "DONE")
    send("Read the following text and reply with exactly: FILLER_OK\n\n", enter=False)
    paste_file("mar", FILLER)
    time.sleep(2)
    send_key("Enter")
    wait_for(lambda es: "FILLER_OK" in last_assistant_text(es), 300, "FILLER_OK")
    send("/compact cached")
    log("sent /compact cached")
    wait_for(lambda es: len(compaction_entries(es)) >= 1, 300, "compaction entry")
    es = entries()
    ce = compaction_entries(es)[-1]
    d = ce.get("details", {})
    log(f"details.mode={d.get('mode')!r} (expect 'cached')")
    log(f"summary has Programmatic section: {'Programmatic' in ce.get('summary', '')} (expect False)")
    summary_injected = [
        u for u in es
        if u.get("type") == "message" and u.get("message", {}).get("role") == "user"
        and msg_text(u.get("message", {})).startswith("Reply with ONLY a standalone structured summary")
    ]
    log(f"summary prompt injected: {len(summary_injected) == 1} (expect True)")
    send("Reply with exactly: POST_COMPACT_OK")
    wait_for(lambda es: "POST_COMPACT_OK" in last_assistant_text(es), 240, "POST_COMPACT_OK")
    log("=== MODEARG-REVERSE COMPLETE ===")


SCENARIOS = {
    "threshold": scenario_threshold,
    "overflow": scenario_overflow,
    "escabort": scenario_escabort,
    "modearg": scenario_modearg,
    "modearg-reverse": scenario_modearg_reverse,
}

if __name__ == "__main__":
    SCENARIOS[SCENARIO]()
