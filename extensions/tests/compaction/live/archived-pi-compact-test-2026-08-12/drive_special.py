#!/usr/bin/env python3
"""Drive special-path tests. Usage: drive_special.py <threshold|overflow|escabort> <win>"""
import json, os, subprocess, sys, time, glob

SCENARIO = sys.argv[1]
WIN = sys.argv[2]
BASE = os.path.expanduser(f"~/pi-compact-test/{SCENARIO}")
SESS_DIR = f"{BASE}/sessions"
LOG = f"{BASE}/driver.log"
TARGET = f"comp-test:{WIN}"

DANCE_PROMPTS = [
    "The messages above are a conversation to summarize",
    "Produce only the agentic state needed to continue this coding session",
    "Write a handoff doc for a new agent to continue the session",
]
OVERFLOW_NOTIFY = "Context overflow: compaction cancelled"
CANCEL_NOTIFY = "Compaction summary cancelled"

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
    return sh("tmux", "capture-pane", "-t", TARGET, "-p", "-S", "-40").stdout

def entries():
    out = []
    for f in sorted(glob.glob(f"{SESS_DIR}/*.jsonl")):
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

def user_msgs(es):
    return [e for e in es if e.get("type") == "message" and e["message"].get("role") == "user"]

def msg_text(m):
    c = m.get("content")
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return "".join(b.get("text", "") for b in c if isinstance(b, dict) and b.get("type") == "text")
    return ""

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
    sys.exit(2)

def wait_boot(timeout=120):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if "deepseek-v4-flash" in capture():
            break
        time.sleep(3)
    else:
        log("TIMEOUT waiting for pi boot")
        sys.exit(2)
    time.sleep(4)
    log("booted")

def paste_file(bufname, path):
    sh("tmux", "load-buffer", "-b", bufname, path)
    time.sleep(0.3)
    sh("tmux", "paste-buffer", "-b", bufname, "-t", TARGET)

def main():
    log(f"=== starting special test: {SCENARIO} (window {WIN}) ===")
    wait_boot()
    send("Write a haiku about caching. Reply with only the haiku.")
    wait_for(lambda es: len(assistant_msgs(es)) >= 1, 240, "haiku reply")
    log("haiku reply received")

    if SCENARIO == "threshold":
        send("Read the following text and reply with exactly: ACK\n\n", enter=False)
        paste_file("thr", os.path.expanduser("~/pi-compact-test/context_filler.txt"))
        time.sleep(2)
        send_key("Enter")
        log("sent threshold filler paste")
        wait_for(lambda es: "ACK" in last_assistant_text(es), 300, "ACK reply (threshold context)")
        log("ACK reply received; waiting for threshold-triggered dance (no /compact)")
        wait_for(lambda es: len(compaction_entries(es)) >= 1, 300, "threshold compaction entry")
        es = entries()
        ce = compaction_entries(es)[-1]
        log(f"threshold compaction: details.mode={ce.get('details', {}).get('mode')!r} tokensBefore={ce.get('tokensBefore')}")
        send("Reply with exactly: POST_COMPACT_OK")
        wait_for(lambda es: "POST_COMPACT_OK" in last_assistant_text(es), 240, "POST_COMPACT_OK reply")
        log("post-compact reply received")
        log("=== THRESHOLD TEST COMPLETE ===")

    elif SCENARIO == "overflow":
        # Paste 3 chunks (~90k tokens each) as separate messages; total context exceeds
        # the 256k window after chunk 3, and messages before the cut make prepareCompaction
        # succeed so the overflow path reaches the extension.
        markers = ["CHUNK_0_END_MARKER_zzz", "CHUNK_1_END_MARKER_zzz", "CHUNK_2_END_MARKER_zzz"]
        for ci in range(3):
            send(f"Here is overflow text chunk {ci}:\n\n", enter=False)
            paste_file(f"ovf{ci}", os.path.expanduser(f"~/pi-compact-test/ovf_chunk_{ci}.txt"))
            log(f"pasted chunk {ci}; waiting for end marker in pane")
            deadline = time.time() + 180
            while time.time() < deadline:
                if markers[ci] in capture():
                    log(f"chunk {ci} end marker visible; submitting")
                    break
                time.sleep(3)
            else:
                log(f"chunk {ci} end marker never appeared; aborting")
                sys.exit(2)
            send_key("Enter")
            # wait for the model reply to this chunk (assistant message count increases)
            base_count = len(assistant_msgs(entries()))
            deadline = time.time() + 240
            while time.time() < deadline:
                if len(assistant_msgs(entries())) > base_count:
                    break
                time.sleep(3)
            else:
                log(f"no reply after chunk {ci}; aborting")
                sys.exit(2)
            log(f"chunk {ci} reply received (context growing)")
        log("all chunks sent; waiting for overflow notify")
        deadline = time.time() + 240
        while time.time() < deadline:
            es = entries()
            pane = capture()
            if OVERFLOW_NOTIFY in pane:
                log("FOUND overflow notify in pane")
                break
            if len(compaction_entries(es)) >= 1:
                log("UNEXPECTED: compaction entry appeared during overflow test")
                break
            time.sleep(5)
        else:
            log("TIMEOUT waiting for overflow notify; pane tail:")
            log(capture())
            sys.exit(2)
        log("=== OVERFLOW TEST COMPLETE ===")

    elif SCENARIO == "escabort":
        send("Read the following text and reply with exactly: ACK\n\n", enter=False)
        paste_file("esc", os.path.expanduser("~/pi-compact-test/context_filler.txt"))
        time.sleep(2)
        send_key("Enter")
        log("sent context paste (to slow the summary turn)")
        wait_for(lambda es: "ACK" in last_assistant_text(es), 300, "ACK reply")
        log("ACK reply received")
        send("/compact")
        log("sent /compact; waiting for injected dance message")
        # Fast-poll for the injected message, then Escape-spam during generation.
        injected_seen = False
        deadline = time.time() + 60
        while time.time() < deadline:
            es = entries()
            if any(msg_text(u["message"]).startswith(p) for u in user_msgs(es) for p in DANCE_PROMPTS):
                injected_seen = True
                break
            time.sleep(0.5)
        if not injected_seen:
            log("injected dance message not seen; aborting")
            sys.exit(2)
        log("injected dance message found; sending Escape during summary generation")
        for i in range(12):
            send_key("Escape")
            time.sleep(1)
            es = entries()
            if len(compaction_entries(es)) >= 1:
                break
            pane = capture()
            if CANCEL_NOTIFY in pane or "Compaction summary" in pane:
                break
        log("Escape spam done; waiting for cancel notify")
        deadline = time.time() + 30
        while time.time() < deadline:
            pane = capture()
            if CANCEL_NOTIFY in pane:
                log("FOUND cancel notify in pane")
                break
            time.sleep(2)
        else:
            log("cancel notify not seen; pane tail:")
            log(capture())
        es = entries()
        n_comp = len(compaction_entries(es))
        n_inj = sum(1 for u in user_msgs(es) if any(msg_text(u["message"]).startswith(p) for p in DANCE_PROMPTS))
        log(f"after Escape: compaction entries={n_comp}, injected dance messages={n_inj}")
        log("=== ESC-ABORT TEST COMPLETE ===")

if __name__ == "__main__":
    main()
