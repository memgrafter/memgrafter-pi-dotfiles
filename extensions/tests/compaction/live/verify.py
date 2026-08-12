#!/usr/bin/env python3
"""Verify a compaction-mode test session file.

Usage: verify.py <mode> [--json]

Checks:
  - exactly one injected dance message
  - compaction entry present, details.mode matches, tokensBefore present
  - dance modes: firstKeptEntryId is the keep-none sentinel
  - tooltrace modes: summary contains the Programmatic section
  - summary reply captured between injection and compaction entry
  - summary reply cacheRead ~= full context (provider cache reuse)
  - post-compact follow-up reply works
"""
import json
import glob
import sys
import os

MODE = sys.argv[1]
HARNESS = os.path.dirname(os.path.abspath(__file__))
SESS_DIR = os.path.join(HARNESS, "runs", MODE, "sessions")

DANCE_PROMPTS = [
    "The messages above are a conversation to summarize",
    "Produce only the agentic state needed to continue this coding session",
    "Write a handoff doc for a new agent to continue the session",
]
SENTINEL = "__pi_compaction_modes_keep_none__"
DANCE_MODES = {"cached", "cached-agentic", "cached-agentic-tooltraces", "cached-handoff", "cached-handoff-tooltraces", "cached-summary-tooltraces"}
TOOLTRACE_MODES = {"cached-agentic-tooltraces", "cached-handoff-tooltraces", "cached-summary-tooltraces"}


def load():
    es = []
    for f in sorted(glob.glob(os.path.join(SESS_DIR, "*.jsonl"))):
        with open(f) as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    es.append(json.loads(line))
                except Exception:
                    pass
    return es


def msg_text(m):
    c = m.get("content")
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return "".join(b.get("text", "") for b in c if isinstance(b, dict) and b.get("type") == "text")
    return ""


results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}: {name} {detail}")


es = load()
msgs = [e for e in es if e.get("type") == "message"]
users = [e for e in msgs if e["message"].get("role") == "user"]
assistants = [e for e in msgs if e["message"].get("role") == "assistant"]
comps = [e for e in es if e.get("type") == "compaction"]

if not es:
    print("FAIL: no session entries found")
    sys.exit(1)

print(f"mode={MODE} entries={len(es)} users={len(users)} assistants={len(assistants)} compactions={len(comps)}")

# 1. Injected dance message count
injected = [u for u in users if any(msg_text(u["message"]).startswith(p) for p in DANCE_PROMPTS)]
if MODE in DANCE_MODES:
    check("exactly one injected dance message", len(injected) == 1, f"count={len(injected)}")
else:
    check("no injected dance message (non-dance mode)", len(injected) == 0, f"count={len(injected)}")

# 2. Compaction entry
check("compaction entry present", len(comps) >= 1, f"count={len(comps)}")
if comps:
    ce = comps[-1]
    details = ce.get("details", {})
    check("details.mode matches", details.get("mode") == MODE or MODE == "vanilla", f"details.mode={details.get('mode')!r}")
    check("tokensBefore present", isinstance(ce.get("tokensBefore"), (int, float)), f"tokensBefore={ce.get('tokensBefore')}")
    summary = ce.get("summary", "")
    check("summary non-empty", len(summary) > 200, f"len={len(summary)}")
    if MODE in DANCE_MODES:
        check("dance: firstKeptEntryId is sentinel", ce.get("firstKeptEntryId") == SENTINEL, f"firstKeptEntryId={ce.get('firstKeptEntryId')!r}")
    else:
        check("non-dance: firstKeptEntryId is an entry id", bool(ce.get("firstKeptEntryId")), f"firstKeptEntryId={ce.get('firstKeptEntryId')!r}")
    if MODE in TOOLTRACE_MODES:
        check("tooltrace section present", "Programmatic" in summary, "summary contains 'Programmatic' section")
    elif MODE == "programmatic":
        check("programmatic summary present", "Programmatic" in summary, "summary contains 'Programmatic' section")
    elif MODE in DANCE_MODES:
        check("no tooltrace section (non-tooltrace dance mode)", "Programmatic" not in summary, "")
    else:
        check("vanilla summary present", len(summary) > 100, f"len={len(summary)}")

# 3. Summary reply captured between injection and compaction
if injected:
    inj_time = injected[0]["timestamp"]
    comp_time = comps[-1]["timestamp"] if comps else None
    summary_msgs = [a for a in assistants if a["timestamp"] >= inj_time and (comp_time is None or a["timestamp"] < comp_time)]
    check("summary reply before compaction", len(summary_msgs) == 1, f"count={len(summary_msgs)}")
    if summary_msgs:
        summary_text = msg_text(summary_msgs[0]["message"])
        check("summary reply non-empty", len(summary_text) > 100, f"len={len(summary_text)}")
        usage = summary_msgs[0]["message"].get("usage", {})
        cache_read = usage.get("cacheRead", 0)
        inp = usage.get("input", 0)
        if inp > 0:
            total_in = inp + cache_read
            ratio = cache_read / total_in if total_in > 0 else 0
            check("summary reply cacheRead ~= full context", ratio > 0.8, f"cacheRead={cache_read} input={inp} total={total_in} ratio={ratio:.2f}")
        else:
            check("summary reply usage has input", False, f"usage={usage}")

# 4. Post-compact follow-up works
post = [a for a in assistants if a["timestamp"] > (comps[-1]["timestamp"] if comps else "")]
post_text = " ".join(msg_text(a["message"]) for a in post)
check("post-compact reply works", "POST_COMPACT_OK" in post_text, f"assistants after compaction={len(post)}")

fails = [r for r in results if not r[1]]
print(f"\nRESULT: {'ALL PASS' if not fails else f'{len(fails)} FAILED'}")
sys.exit(0 if not fails else 1)
