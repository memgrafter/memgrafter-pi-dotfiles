#!/usr/bin/env python3
"""Drive one compaction-mode test in a tmux window.

Usage: drive.py <mode> <win>

Sequence per session:
  1. wait for pi boot
  2. haiku turn (context)
  3. bash tool-use turn (context, tooltrace content)
  4. filler paste turn (context > keepRecentTokens so /compact is allowed)
  5. /compact (dance for dance modes, direct for programmatic/vanilla)
  6. post-compact follow-up
"""
import json
import os
import subprocess
import sys
import time
import glob

MODE = sys.argv[1]
WIN = sys.argv[2]
HARNESS = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.join(HARNESS, "runs", MODE)
SESS_DIR = os.path.join(BASE, "sessions")
FILLER = os.path.join(HARNESS, "runs", "context_filler.txt")
LOG = os.path.join(BASE, "driver.log")
TARGET = f"comp-test:{WIN}"


def sh(*args, timeout=20):
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout)


def log(msg):
    line = f"{time.strftime('%H:%M:%S')} [{MODE}] {msg}"
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
    return sh("tmux", "capture-pane", "-t", TARGET, "-p", "-S", "-40").stdout


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


def last_assistant_text(es):
    for e in reversed(assistant_msgs(es)):
        m = e["message"]
        c = m.get("content")
        if isinstance(c, str):
            return c
        if isinstance(c, list):
            txt = "".join(b.get("text", "") for b in c if isinstance(b, dict) and b.get("type") == "text")
            if txt:
                return txt
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
    log("waiting for boot (pane shows model line)...")
    deadline = time.time() + timeout
    while time.time() < deadline:
        if "deepseek-v4-flash" in capture():
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
    time.sleep(0.3)
    sh("tmux", "paste-buffer", "-b", bufname, "-t", TARGET)


def main():
    log(f"=== starting test for mode {MODE} (window {WIN}) ===")
    wait_boot()

    # Phase A: haiku (context turn 1)
    send("Write a haiku about caching. Reply with only the haiku.")
    log("sent haiku request")
    wait_for(lambda es: len(assistant_msgs(es)) >= 1, 240, "haiku reply")
    log("haiku reply received")

    # Phase B: bash tool use (context turn 2, gives tooltraces content)
    send(f"Run bash: ls -la {BASE}. Then reply with exactly DONE.")
    log("sent bash task")
    wait_for(lambda es: "DONE" in last_assistant_text(es).upper(), 240, "DONE reply")
    log("bash reply received")

    # Phase B2: filler context so the session exceeds keepRecentTokens (5000)
    # Instruction and paste must land in the SAME editor buffer and submit once.
    send("Read the following text and reply with exactly: FILLER_OK\n\n", enter=False)
    paste_file("ctxfiller", FILLER)
    time.sleep(2)
    send_key("Enter")
    log("sent filler context paste")
    wait_for(lambda es: "FILLER_OK" in last_assistant_text(es), 300, "FILLER_OK reply")
    log("filler reply received")

    # Phase C: /compact (dance)
    send("/compact")
    log("sent /compact; waiting for compaction entry (dance)")
    wait_for(lambda es: len(compaction_entries(es)) >= 1, 300, "compaction entry")
    ce = compaction_entries(entries())[-1]
    log(f"compaction entry found: details.mode={ce.get('details', {}).get('mode')!r}")
    if ce.get("details", {}).get("mode") != MODE:
        log(f"WARNING: expected details.mode {MODE!r}, got {ce.get('details', {}).get('mode')!r}")

    # Phase D: post-compact follow-up
    send("Reply with exactly: POST_COMPACT_OK")
    log("sent post-compact follow-up")
    wait_for(lambda es: "POST_COMPACT_OK" in last_assistant_text(es), 240, "POST_COMPACT_OK reply")
    log("post-compact reply received")
    log("=== TEST DRIVE COMPLETE ===")


if __name__ == "__main__":
    main()
