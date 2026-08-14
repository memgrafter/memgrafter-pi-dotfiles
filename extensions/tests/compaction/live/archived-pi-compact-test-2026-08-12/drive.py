#!/usr/bin/env python3
"""Drive one compaction-mode test in a tmux window. Usage: drive.py <mode> <win>"""
import json, os, subprocess, sys, time, glob

MODE = sys.argv[1]
WIN = sys.argv[2]
BASE = os.path.expanduser(f"~/pi-compact-test/{MODE}")
SESS_DIR = f"{BASE}/sessions"
LOG = f"{BASE}/driver.log"
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

def files():
    return sorted(glob.glob(f"{SESS_DIR}/*.jsonl"))

def entries():
    out = []
    for f in files():
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
        es = entries()
        if pred(es):
            return es
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

    send("Write a haiku about caching. Reply with only the haiku.")
    log("sent haiku request")
    wait_for(lambda es: len(assistant_msgs(es)) >= 1, 240, "haiku reply")
    log("haiku reply received")

    send(f"Run bash: ls -la {BASE}. Then reply with exactly DONE.")
    log("sent bash task")
    wait_for(lambda es: "DONE" in last_assistant_text(es).upper(), 240, "DONE reply")
    log("bash reply received")

    send("Read the following text and reply with exactly: ACK\n\n", enter=False)
    paste_file("ctxfiller", os.path.expanduser("~/pi-compact-test/context_filler.txt"))
    time.sleep(2)
    send_key("Enter")
    log("sent filler context paste")
    wait_for(lambda es: "ACK" in last_assistant_text(es), 300, "ACK reply")
    log("filler reply received")
    es = entries()
    last_usage = assistant_msgs(es)[-1]["message"].get("usage", {})
    total_in = last_usage.get("input", 0) + last_usage.get("cacheRead", 0)
    if total_in < 15000:
        log(f"FAIL: filler context too small (total_in={total_in}); aborting")
        sys.exit(3)

    send("/compact")
    log("sent /compact; waiting for compaction entry (dance)")
    wait_for(lambda es: len(compaction_entries(es)) >= 1, 300, "compaction entry")
    es = entries()
    ce = compaction_entries(es)[-1]
    log(f"compaction entry found: details.mode={ce.get('details', {}).get('mode')!r}")
    if ce.get("details", {}).get("mode") != MODE:
        log(f"WARNING: expected details.mode {MODE!r}, got {ce.get('details', {}).get('mode')!r}")

    send("Reply with exactly: POST_COMPACT_OK")
    log("sent post-compact follow-up")
    wait_for(lambda es: "POST_COMPACT_OK" in last_assistant_text(es), 240, "POST_COMPACT_OK reply")
    log("post-compact reply received")
    log("=== TEST DRIVE COMPLETE ===")

if __name__ == "__main__":
    main()
