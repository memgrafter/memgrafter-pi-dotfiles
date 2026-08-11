#!/usr/bin/env python3
"""Ingest pi session JSONL files into rounds.jsonl metrics records.

pi's rounds.jsonl is an append-only log that only started capturing on
2026-08-09. Sessions older than that have full history in the session files
(~/.pi/agent/sessions/<cwd>/<ts>_<sessionId>.jsonl) but no metric records.
This tool reconstructs round/compaction metric records from those files and
appends them to rounds.jsonl.

Reconstruction mirrors pi's own aggregation, verified against live records:
  - a "round" starts at each user message and ends at the next user message
  - round usage      = sum of that round's assistant-message usages
  - turnCount        = number of assistant messages in the round
  - toolCalls        = count of toolCall content entries in the round
  - stopReason       = last assistant message's stopReason
  - cost             = pi's calculateCost() applied to each turn's usage
                       (top-level cost = sum of per-turn costs, as pi does)
  - compaction       = each compaction entry -> one metric record

Idempotent and cross-machine safe: records are keyed by sessionId (a UUID
inside the file content, not a path), so re-running on the same or a
duplicated session-file tree never double-ingests. Deterministic output:
every field is derived from file content and the rate table, so two machines
ingesting the same files produce identical records.

Cost rates: embedded deepseek defaults, merged with ~/.pi/agent/models.json
and models-store.json (provider -> model -> cost). Pass --rates-file to pin
an identical table across machines. Models without a rate entry get zero
cost (counted and reported as "unpriced").

Usage:
  session_ingest.py                      # scan default dir, patch live file
  session_ingest.py --dry-run            # report only
  session_ingest.py --sessions-dir DIR   # point at another machine's sessions
  session_ingest.py --verify             # validate metrics file + costs only
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_METRICS = Path.home() / ".pi" / "agent" / "metrics" / "rounds.jsonl"
DEFAULT_SESSIONS = Path.home() / ".pi" / "agent" / "sessions"
DEFAULT_MODELS_JSON = Path.home() / ".pi" / "agent" / "models.json"
DEFAULT_MODELS_STORE = Path.home() / ".pi" / "agent" / "models-store.json"
DEFAULT_BACKUP_DIR = Path.home() / "backups"

# Per-1M-token rates ($). Fallback only; models.json / models-store.json win.
DEFAULT_RATES: dict[str, dict] = {
    "deepseek-v4-flash": {"input": 0.14, "output": 0.28, "cacheRead": 0.0028, "cacheWrite": 0},
    "deepseek-v4-pro": {"input": 0.435, "output": 0.87, "cacheRead": 0.003625, "cacheWrite": 0},
    # Anthropic rates from pi's builtin anthropic.json (stable pricing).
    "claude-fable-5": {"input": 10, "output": 50, "cacheRead": 1, "cacheWrite": 12.5},
    "claude-haiku-4-5": {"input": 1, "output": 5, "cacheRead": 0.1, "cacheWrite": 1.25},
    "claude-haiku-4-5-20251001": {"input": 1, "output": 5, "cacheRead": 0.1, "cacheWrite": 1.25},
    "claude-opus-4-1": {"input": 15, "output": 75, "cacheRead": 1.5, "cacheWrite": 18.75},
    "claude-opus-4-1-20250805": {"input": 15, "output": 75, "cacheRead": 1.5, "cacheWrite": 18.75},
    "claude-opus-4-5": {"input": 5, "output": 25, "cacheRead": 0.5, "cacheWrite": 6.25},
    "claude-opus-4-5-20251101": {"input": 5, "output": 25, "cacheRead": 0.5, "cacheWrite": 6.25},
    "claude-opus-4-6": {"input": 5, "output": 25, "cacheRead": 0.5, "cacheWrite": 6.25},
    "claude-opus-4-7": {"input": 5, "output": 25, "cacheRead": 0.5, "cacheWrite": 6.25},
    "claude-opus-4-8": {"input": 5, "output": 25, "cacheRead": 0.5, "cacheWrite": 6.25},
    "claude-opus-5": {"input": 5, "output": 25, "cacheRead": 0.5, "cacheWrite": 6.25},
    "claude-sonnet-4-5": {"input": 3, "output": 15, "cacheRead": 0.3, "cacheWrite": 3.75},
    "claude-sonnet-4-5-20250929": {"input": 3, "output": 15, "cacheRead": 0.3, "cacheWrite": 3.75},
    "claude-sonnet-4-6": {"input": 3, "output": 15, "cacheRead": 0.3, "cacheWrite": 3.75},
    "claude-sonnet-5": {"input": 2, "output": 10, "cacheRead": 0.2, "cacheWrite": 2.5},
}

# Provider-qualified rates (per 1M tokens). Needed when the same model id has
# different economics per provider (self-hosted vllm == $0, paid API == price).
# Crusoe Cloud serverless inference pricing, fetched 2026-08-09 from
# https://www.crusoe.ai/cloud/pricing (pay-as-you-go). Both id casings included.
DEFAULT_PROVIDER_RATES: dict[tuple[str, str], dict] = {
    ("crusoecloud", "deepseek-ai/Deepseek-V4-Flash"): {"input": 0.14, "output": 0.28, "cacheRead": 0.03, "cacheWrite": 0},
    ("crusoecloud", "deepseek-ai/DeepSeek-V4-Flash"): {"input": 0.14, "output": 0.28, "cacheRead": 0.03, "cacheWrite": 0},
    ("crusoecloud", "deepseek-ai/DeepSeek-V4-Pro"): {"input": 1.74, "output": 3.48, "cacheRead": 0.15, "cacheWrite": 0},
    # Cerebras serverless pricing, fetched 2026-08-09 from cerebras.ai/pricing.
    # GLM 4.6 and 4.7 share the same rate (4.7 is the same model, updated).
    # No prompt caching on Cerebras, so cacheRead = 0.
    ("cerebras", "zai-glm-4.6"): {"input": 2.25, "output": 2.75, "cacheRead": 0, "cacheWrite": 0},
    ("cerebras", "zai-glm-4.7"): {"input": 2.25, "output": 2.75, "cacheRead": 0, "cacheWrite": 0},
    ("cerebras", "gpt-oss-120b"): {"input": 0.35, "output": 0.75, "cacheRead": 0, "cacheWrite": 0},
    ("cerebras", "gemma-4-31b-it"): {"input": 0.99, "output": 1.49, "cacheRead": 0, "cacheWrite": 0},
    # 9router-kiro is a paid local gateway (localhost:20127) with no published
    # rate yet; leave its models unpriced until the user supplies a table.
}

COST_FIELDS = ("input", "output", "cacheRead", "cacheWrite")
USAGE_FIELDS = ("input", "output", "cacheRead", "cacheWrite", "reasoning")
TOOL_CONTENT_TYPES = ("toolCall", "tool_use", "functionCall")
PENDING_STOP = (None, "pending")


def _to_ms(ts) -> int:
    """ISO-8601 timestamp (or already-ms) -> epoch milliseconds, UTC-normalized."""
    if isinstance(ts, (int, float)):
        return int(ts)
    if isinstance(ts, str):
        norm = ts.replace("Z", "+00:00") if ts.endswith("Z") else ts
        try:
            return int(datetime.fromisoformat(norm).timestamp() * 1000)
        except ValueError:
            pass
    return 0


def _select_rates(cost_cfg: dict, usage: dict) -> dict:
    """Mirror pi's tier selection: highest tier whose inputTokensAbove is exceeded."""
    input_tokens = usage.get("input", 0) + usage.get("cacheRead", 0) + usage.get("cacheWrite", 0)
    rates = cost_cfg
    matched = -1
    for tier in cost_cfg.get("tiers") or []:
        above = tier.get("inputTokensAbove", 0)
        if input_tokens > above and above > matched:
            rates = tier
            matched = above
    return rates


def calculate_cost(usage: dict, cost_cfg: dict | None) -> dict:
    """Compute the cost object pi's calculateCost would produce (zeros if no rates)."""
    if not cost_cfg:
        return {k: 0.0 for k in (*COST_FIELDS, "total")}
    rates = _select_rates(cost_cfg, usage)
    long_write = usage.get("cacheWrite1h", 0)
    short_write = usage.get("cacheWrite", 0) - long_write
    cost = {
        "input": (rates["input"] / 1_000_000) * usage.get("input", 0),
        "output": (rates["output"] / 1_000_000) * usage.get("output", 0),
        "cacheRead": (rates["cacheRead"] / 1_000_000) * usage.get("cacheRead", 0),
        "cacheWrite": (rates["cacheWrite"] * short_write + rates["input"] * 2 * long_write) / 1_000_000,
    }
    cost["total"] = cost["input"] + cost["output"] + cost["cacheRead"] + cost["cacheWrite"]
    return cost


def load_rate_table(models_json: Path, models_store: Path, rates_file: Path | None) -> dict:
    """Build {(provider, model): cost_cfg, model: cost_cfg} from local configs."""
    table: dict = {}
    sources = []
    if models_json.exists():
        sources.append(json.loads(models_json.read_text()))
    if models_store.exists():
        sources.append(json.loads(models_store.read_text()))
    for doc in sources:
        for provider, pv in (doc.get("providers") or doc).items():
            if not isinstance(pv, dict):
                continue
            for m in pv.get("models") or []:
                if not isinstance(m, dict) or "cost" not in m:
                    continue
                mid = m.get("id")
                if mid:
                    table[(provider, mid)] = m["cost"]
                    table.setdefault(mid, m["cost"])
    for mid, cfg in DEFAULT_RATES.items():  # embedded fallback; configs win
        table.setdefault(mid, cfg)
    for key, cfg in DEFAULT_PROVIDER_RATES.items():  # provider-qualified; configs win
        table.setdefault(key, cfg)
    if rates_file and rates_file.exists():
        table.update(json.loads(rates_file.read_text()))
    return table


def rate_for(table: dict, provider: str | None, model: str | None) -> dict | None:
    """Look up rates, trying provider-qualified then bare id, then normalized aliases.

    Normalization strips :thinking / :reasoning suffixes and "-thinking" model
    aliases (e.g. deepseek/deepseek-v4-flash:thinking -> deepseek/deepseek-v4-flash).
    """
    if not model:
        return None
    candidates = [model]
    normalized = (
        model.replace(":thinking", "")
        .replace(":reasoning", "")
        .replace("-thinking", "")
    )
    if normalized != model:
        candidates.append(normalized)
    for cand in candidates:
        if provider:
            hit = table.get((provider, cand))
            if hit:
                return hit
        hit = table.get(cand)
        if hit:
            return hit
    return None


# --- session file parsing -------------------------------------------------

def parse_session_file(path: Path, table: dict) -> dict:
    """Return {sessionId, cwd, rounds: [...], compactions: [...]} or raise."""
    session_id = None
    cwd = None
    provider = model = thinking_level = None
    rounds: list[dict] = []
    compactions: list[dict] = []
    current: dict | None = None

    for line in path.read_text(errors="replace").splitlines():
        if not line.strip():
            continue
        entry = json.loads(line)
        etype = entry.get("type")
        if etype == "session":
            session_id = entry.get("sessionId") or entry.get("id")
            cwd = entry.get("cwd")
        elif etype == "model_change":
            provider = entry.get("provider") or provider
            model = entry.get("modelId") or entry.get("model") or model
        elif etype == "thinking_level_change":
            thinking_level = entry.get("thinkingLevel") or thinking_level
        elif etype == "compaction":
            usage = entry.get("usage") or {}
            compactions.append({
                "ts": _to_ms(entry.get("timestamp") or entry.get("ts")),
                "usage": _normalize_usage(usage),
                "model": model,
                "provider": provider,
            })
        elif etype == "message":
            msg = entry.get("message") or {}
            role = msg.get("role")
            # Old-format session files lack model_change entries but carry
            # model/provider on messages — capture as fallback.
            if msg.get("model"):
                model = msg.get("model")
            if msg.get("provider"):
                provider = msg.get("provider")
            if role == "user":
                current = {
                    "start_ts": _to_ms(entry.get("timestamp") or msg.get("timestamp")),
                    "turns": [],          # per-assistant usage + latency
                    "tool_calls": 0,      # toolCall content entries
                    "tools": {},          # name -> calls
                    "end_ts": None,
                    "stop_reason": None,
                }
                rounds.append(current)
            elif current is not None and role == "assistant":
                usage = _normalize_usage(msg.get("usage") or {})
                current["turns"].append({
                    "latency_ms": msg.get("latencyMs") or 0,
                    "usage": usage,
                })
                ts = _to_ms(entry.get("timestamp") or msg.get("timestamp"))
                if ts:
                    current["end_ts"] = ts
                sr = msg.get("stopReason")
                if sr:
                    current["stop_reason"] = sr
                for chunk in msg.get("content") or []:
                    if isinstance(chunk, dict) and chunk.get("type") in TOOL_CONTENT_TYPES:
                        current["tool_calls"] += 1
                        name = chunk.get("name") or "unknown"
                        tools = current["tools"].setdefault(name, {"calls": 0, "errors": 0, "durationMs": 0})
                        tools["calls"] += 1
    return {
        "sessionId": session_id,
        "cwd": cwd,
        "provider": provider,
        "model": model,
        "thinkingLevel": thinking_level or "off",
        "rounds": rounds,
        "compactions": compactions,
    }


def _normalize_usage(u: dict) -> dict:
    """Normalize a usage object to pi's field set; totalTokens = sum of parts."""
    clean = {k: int(u.get(k, 0) or 0) for k in USAGE_FIELDS}
    clean["totalTokens"] = clean["input"] + clean["output"] + clean["cacheRead"] + clean["cacheWrite"]
    return clean


# --- record building ------------------------------------------------------

def build_records(parsed: dict, filename: str, table: dict, stats: dict) -> list[dict]:
    """Turn a parsed session into metric records (round + compaction)."""
    records = []
    cost_cfg = rate_for(table, parsed["provider"], parsed["model"])
    if cost_cfg is None and parsed["model"]:
        stats["unpriced_models"].add(parsed["model"])

    for rnd in parsed["rounds"]:
        if not rnd["turns"]:
            stats["empty_rounds"] += 1
            continue  # user message with no assistant response (aborted/gap)
        if rnd["end_ts"] is None and rnd["stop_reason"] in PENDING_STOP:
            stats["in_flight"] += 1
            continue  # trailing in-flight round, no record yet in pi either
        turns = []
        usage = {k: 0 for k in USAGE_FIELDS}
        usage["totalTokens"] = 0
        cost = {k: 0.0 for k in (*COST_FIELDS, "total")}
        for t in rnd["turns"]:
            u = t["usage"]
            for k in USAGE_FIELDS:
                usage[k] += u[k]
            turn_cost = calculate_cost(u, cost_cfg)
            for k in COST_FIELDS:
                cost[k] += turn_cost[k]
            turns.append({"latencyMs": t["latency_ms"], "usage": {**u, "cost": turn_cost}})
        usage["totalTokens"] = usage["input"] + usage["output"] + usage["cacheRead"] + usage["cacheWrite"]
        cost["total"] = cost["input"] + cost["output"] + cost["cacheRead"] + cost["cacheWrite"]
        records.append({
            "kind": "round",
            "ingested": True,  # written by this ingester; enables round-level dedupe
            "ts": rnd["start_ts"],
            "sessionId": parsed["sessionId"],
            "sessionFile": filename,
            "cwd": parsed["cwd"],
            "provider": parsed["provider"],
            "model": parsed["model"],
            "models": [parsed["model"]] if parsed["model"] else [],
            "thinkingLevel": parsed["thinkingLevel"],
            "durationMs": (rnd["end_ts"] - rnd["start_ts"]) if rnd["end_ts"] else 0,
            "runs": 1,
            "turnCount": len(turns),
            "turns": turns,
            "toolCalls": rnd["tool_calls"],
            "tools": rnd["tools"],
            "stopReason": rnd["stop_reason"] or "stop",
            "errorMessage": None,
            "usage": usage,
            "cost": cost,
        })
        stats["rounds"] += 1

    for comp in parsed["compactions"]:
        cost = calculate_cost(comp["usage"], rate_for(table, comp["provider"], comp["model"]))
        records.append({
            "kind": "compaction",
            "ingested": True,  # written by this ingester; enables round-level dedupe
            "ts": comp["ts"],
            "sessionId": parsed["sessionId"],
            "sessionFile": filename,
            "cwd": parsed["cwd"],
            "provider": comp["provider"],
            "model": comp["model"],
            "models": [comp["model"]] if comp["model"] else [],
            "durationMs": 0,
            "runs": 0,
            "turnCount": 0,
            "toolCalls": 0,
            "stopReason": "compaction",
            "errorMessage": None,
            "usage": comp["usage"],
            "cost": cost,
        })
        stats["compactions"] += 1
    return records


# --- file I/O -------------------------------------------------------------

def read_stable(path: Path, max_attempts: int = 5) -> str:
    """Read a live file, retrying if it grows (pi appends while we work)."""
    for attempt in range(max_attempts):
        before = path.stat().st_size
        text = path.read_text()
        time.sleep(0.05)
        if path.stat().st_size == before:
            return text
        print(f"  metrics file changed during read; retrying ({attempt + 1}/{max_attempts})")
    raise RuntimeError(f"{path} keeps changing; refusing to write a moving file")


def dump_records(records: list[dict]) -> str:
    return "\n".join(json.dumps(r, separators=(",", ":")) for r in records) + "\n"


def load_metrics_records(path: Path) -> list[dict]:
    """Parse rounds.jsonl leniently (skip malformed lines)."""
    out = []
    if not path.exists():
        return out
    for line in path.read_text(errors="replace").splitlines():
        if not line.strip():
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def known_session_ids(path: Path) -> set:
    if not path.exists():
        return set()
    ids = set()
    for line in path.read_text(errors="replace").splitlines():
        if not line.strip():
            continue
        try:
            ids.add(json.loads(line).get("sessionId"))
        except json.JSONDecodeError:
            continue
    return ids


def verify_metrics(path: Path, table: dict) -> tuple[int, list[str]]:
    """Parse every record; check shape and cost agreement with the rate table.

    Mirror pi's aggregation: round cost = sum of per-turn costs (each turn
    priced individually, so tier thresholds apply per turn, not to the sum).
    """
    problems: list[str] = []
    priced = 0
    for i, line in enumerate(path.read_text(errors="replace").splitlines()):
        if not line.strip():
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            problems.append(f"line {i}: invalid JSON")
            continue
        if "sessionId" not in rec or "usage" not in rec or "cost" not in rec:
            problems.append(f"line {i}: missing required fields")
            continue
        cost_cfg = rate_for(table, rec.get("provider"), rec.get("model"))
        if cost_cfg is None or not any(rec.get("cost", {}).get(k) for k in COST_FIELDS):
            continue
        turns = rec.get("turns")
        if isinstance(turns, list) and turns:
            expected = {k: 0.0 for k in (*COST_FIELDS, "total")}
            for t in turns:
                tc = calculate_cost(t.get("usage") or {}, cost_cfg)
                for k in COST_FIELDS:
                    expected[k] += tc[k]
            expected["total"] = sum(expected[k] for k in COST_FIELDS)
        else:
            expected = calculate_cost(rec["usage"], cost_cfg)
        priced += 1
        for k in (*COST_FIELDS, "total"):
            if abs(rec["cost"].get(k, 0) - expected[k]) > 1e-9:
                problems.append(f"line {i}: cost.{k} {rec['cost'].get(k)} != {expected[k]}")
    return priced, problems


# --- main ----------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--sessions-dir", type=Path, default=DEFAULT_SESSIONS)
    ap.add_argument("--metrics", type=Path, default=DEFAULT_METRICS)
    ap.add_argument("--models-json", type=Path, default=DEFAULT_MODELS_JSON)
    ap.add_argument("--models-store", type=Path, default=DEFAULT_MODELS_STORE)
    ap.add_argument("--rates-file", type=Path, help="JSON {model or 'provider/model': rates}; overrides configs")
    ap.add_argument("--backup-dir", type=Path, default=DEFAULT_BACKUP_DIR)
    ap.add_argument("--dry-run", action="store_true", help="report only, write nothing")
    ap.add_argument("--no-backup", action="store_true")
    ap.add_argument("--verify", action="store_true", help="validate metrics file only")
    ap.add_argument("--migrate-backup", type=Path, metavar="BACKUP",
                    help="tag records added since BACKUP with the ingested marker "
                         "(one-time upgrade from pre-marker ingester runs)")
    ap.add_argument("--reprice", action="store_true",
                    help="recompute cost for zero-cost records using the current "
                         "rate table (fills rate-table gaps without touching priced records)")
    args = ap.parse_args()

    table = load_rate_table(args.models_json, args.models_store, args.rates_file)

    if args.reprice:
        return reprice(args, table)

    if args.migrate_backup:
        backup_keys = {(r.get("sessionId"), r.get("ts"), r.get("kind"))
                       for r in load_metrics_records(args.migrate_backup)}
        current = read_stable(args.metrics)
        out = []
        changed = 0
        for line in current.splitlines():
            if not line.strip():
                continue
            rec = json.loads(line)
            if not rec.get("ingested") and (rec.get("sessionId"), rec.get("ts"), rec.get("kind")) not in backup_keys:
                rec["ingested"] = True
                changed += 1
            out.append(rec)
        if not args.no_backup:
            ts = time.strftime("%Y-%m-%d_%H-%M-%S")
            backup_path = args.backup_dir / f"rounds.jsonl_{ts}.bak"
            args.backup_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(args.metrics, backup_path)
            print(f"backup: {backup_path}")
        fd, tmp = tempfile.mkstemp(dir=args.metrics.parent, prefix=".rounds.jsonl.", suffix=".tmp")
        try:
            with os.fdopen(fd, "w") as fh:
                fh.write(dump_records(out))
            os.replace(tmp, args.metrics)
        except BaseException:
            os.unlink(tmp)
            raise
        priced, problems = verify_metrics(args.metrics, table)
        print(f"migrated: {changed} record(s) tagged as ingested; "
              f"verify {'ok (' + str(priced) + ' priced objects)' if not problems else 'FAILED'}")
        for p in problems[:10]:
            print(f"  {p}")
        return 1 if problems else 0

    if args.verify:
        priced, problems = verify_metrics(args.metrics, table)
        for p in problems[:20]:
            print(f"  {p}")
        if problems:
            print(f"VERIFY FAILED: {len(problems)} problem(s)")
            return 1
        print(f"verify ok: {priced} priced cost objects agree with the rate table")
        return 0

    if not args.sessions_dir.is_dir():
        print(f"ERROR: sessions dir not found: {args.sessions_dir}")
        return 1

    # pi-managed sessions (records without the ingested marker) stay authoritative
    # and are skipped whole; ingested sessions dedupe per record by
    # (sessionId, kind, ts) — a compaction shares its ts with the round it
    # summarizes, so kind must be part of the key.
    existing = load_metrics_records(args.metrics)
    known_pi = {r.get("sessionId") for r in existing if not r.get("ingested")}
    known_records = {(r.get("sessionId"), r.get("kind"), r.get("ts")) for r in existing if r.get("ingested")}
    stats = {"files": 0, "skipped_pi": 0, "dup_rounds": 0, "unparsed": 0, "no_session_id": 0,
             "rounds": 0, "compactions": 0, "empty_rounds": 0, "in_flight": 0}
    stats["unpriced_models"] = set()
    new_records: list[dict] = []
    ingested_sessions: list[str] = []

    for path in sorted(args.sessions_dir.rglob("*.jsonl")):
        stats["files"] += 1
        try:
            parsed = parse_session_file(path, table)
        except Exception as exc:
            stats["unparsed"] += 1
            print(f"  WARN unparseable: {path.name}: {exc}")
            continue
        if not parsed["sessionId"]:
            stats["no_session_id"] += 1
            continue
        if parsed["sessionId"] in known_pi:
            stats["skipped_pi"] += 1
            continue
        records = build_records(parsed, path.name, table, stats)
        fresh = [r for r in records if (r.get("sessionId"), r.get("kind"), r.get("ts")) not in known_records]
        stats["dup_rounds"] += len(records) - len(fresh)
        for r in fresh:  # dedupe duplicated files within this tree
            known_records.add((r.get("sessionId"), r.get("kind"), r.get("ts")))
        if fresh:
            ingested_sessions.append(parsed["sessionId"])
            new_records.extend(fresh)

    print(f"session files scanned: {stats['files']}")
    print(f"  pi-managed sessions (skipped): {stats['skipped_pi']}   duplicate rounds dropped: {stats['dup_rounds']}")
    print(f"  no sessionId: {stats['no_session_id']}   unparseable: {stats['unparsed']}")
    fresh_rounds = sum(1 for r in new_records if r.get("kind") == "round")
    print(f"new records: {len(new_records)} ({fresh_rounds} rounds, {len(new_records) - fresh_rounds} compactions) "
          f"from {len(ingested_sessions)} session(s); {stats['dup_rounds']} duplicates dropped")
    print(f"  empty rounds skipped: {stats['empty_rounds']}   in-flight skipped: {stats['in_flight']}")
    unpriced = sorted(stats["unpriced_models"])
    print(f"  unpriced models (cost stays $0): {len(unpriced)}"
          + (f" -> {', '.join(unpriced[:10])}" if unpriced else ""))

    if args.dry_run or not new_records:
        if new_records:
            total_cost = sum(r["cost"]["total"] for r in new_records)
            total_tokens = sum(r["usage"]["totalTokens"] for r in new_records)
            print(f"dry-run: would append {len(new_records)} records "
                  f"({total_tokens:,} tokens, ${total_cost:.4f}) to {args.metrics}")
        else:
            print("nothing to ingest")
        return 0

    backup_path = None
    if not args.no_backup:
        ts = time.strftime("%Y-%m-%d_%H-%M-%S")
        backup_path = args.backup_dir / f"rounds.jsonl_{ts}.bak"
        args.backup_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(args.metrics, backup_path)

    current = read_stable(args.metrics)
    # re-dedupe against anything appended since we scanned (record-level for
    # ingested records, session-level for pi-managed ones)
    existing = load_metrics_records(args.metrics)
    still_pi = {r.get("sessionId") for r in existing if not r.get("ingested")}
    still_records = {(r.get("sessionId"), r.get("kind"), r.get("ts")) for r in existing if r.get("ingested")}
    to_append = [
        r for r in new_records
        if r.get("sessionId") not in still_pi
        and (r.get("sessionId"), r.get("kind"), r.get("ts")) not in still_records
    ]

    fd, tmp = tempfile.mkstemp(dir=args.metrics.parent, prefix=".rounds.jsonl.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as fh:
            fh.write(current)
            if current and not current.endswith("\n"):
                fh.write("\n")
            fh.write(dump_records(to_append))
        os.replace(tmp, args.metrics)
    except BaseException:
        os.unlink(tmp)
        raise

    priced, problems = verify_metrics(args.metrics, table)
    if problems:
        print(f"POST-WRITE VERIFY FAILED: {len(problems)} problem(s)")
        for p in problems[:20]:
            print(f"  {p}")
        return 1
    total_cost = sum(r["cost"]["total"] for r in to_append)
    print(f"backup: {backup_path}" if backup_path else "backup: skipped")
    print(f"appended {len(to_append)} records to {args.metrics} "
          f"(${total_cost:.4f} total; {priced} priced objects verified)")
    return 0


def reprice(args: argparse.Namespace, table: dict) -> int:
    """Recompute cost for zero-cost records whose model now has rates.

    Uses per-turn pricing for rounds (pi's semantics) and direct pricing for
    compactions. Priced records are left untouched; nothing is appended or
    removed — only the cost objects are filled in. Records whose model is
    unknown ("?", old-format files without model_change entries) are
    recovered from their session file (message-level model/provider fields)
    when --sessions-dir is available.
    """
    text = read_stable(args.metrics)
    records = load_metrics_records(args.metrics)
    parsed_cache: dict[str, dict | None] = {}
    updated = 0
    delta = 0.0
    recovered = 0

    def recover(rec: dict) -> tuple[str | None, str | None]:
        sf = rec.get("sessionFile")
        if not sf:
            return None, None
        if sf not in parsed_cache:
            parsed_cache[sf] = None
            dirs = [d for d in (args.sessions_dir, DEFAULT_SESSIONS) if d and d.is_dir()]
            for d in dirs:
                for f in d.rglob(sf):
                    try:
                        parsed_cache[sf] = parse_session_file(f, table)
                    except Exception:
                        parsed_cache[sf] = None
                    break
                if parsed_cache[sf]:
                    break
        parsed = parsed_cache[sf]
        if parsed:
            return parsed.get("model"), parsed.get("provider")
        return None, None

    for rec in records:
        if (rec.get("cost") or {}).get("total") not in (0, 0.0, None):
            continue
        if not any((rec.get("usage") or {}).get(k) for k in COST_FIELDS):
            continue
        provider, model = rec.get("provider"), rec.get("model")
        cost_cfg = rate_for(table, provider, model)
        if cost_cfg is None and model in (None, "?"):
            new_model, new_provider = recover(rec)
            if new_model:
                rec["model"] = new_model
                rec["models"] = [new_model]
                if new_provider:
                    rec["provider"] = new_provider
                provider, model = new_provider, new_model
                cost_cfg = rate_for(table, provider, model)
                recovered += 1
        if cost_cfg is None:
            continue
        turns = rec.get("turns")
        if isinstance(turns, list) and turns:
            cost = {k: 0.0 for k in (*COST_FIELDS, "total")}
            for t in turns:
                tc = calculate_cost(t.get("usage") or {}, cost_cfg)
                for k in COST_FIELDS:
                    cost[k] += tc[k]
            cost["total"] = sum(cost[k] for k in COST_FIELDS)
        else:
            cost = calculate_cost(rec["usage"], cost_cfg)
        if cost["total"] <= 0:
            continue
        rec["cost"] = cost
        updated += 1
        delta += cost["total"]
    print(f"reprice: {updated} record(s) filled, +${delta:.4f} total"
          + (f" ({recovered} model recovered from session files)" if recovered else ""))
    if updated == 0:
        return 0
    backup_path = None
    if not args.no_backup:
        ts = time.strftime("%Y-%m-%d_%H-%M-%S")
        backup_path = args.backup_dir / f"rounds.jsonl_{ts}.bak"
        args.backup_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(args.metrics, backup_path)
        print(f"backup: {backup_path}")
    fd, tmp = tempfile.mkstemp(dir=args.metrics.parent, prefix=".rounds.jsonl.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as fh:
            fh.write(dump_records(records))
        os.replace(tmp, args.metrics)
    except BaseException:
        os.unlink(tmp)
        raise
    priced, problems = verify_metrics(args.metrics, table)
    if problems:
        print(f"POST-REPRICE VERIFY FAILED: {len(problems)} problem(s)")
        for p in problems[:20]:
            print(f"  {p}")
        return 1
    print(f"post-reprice verify ok: {priced} priced cost objects agree")
    return 0


if __name__ == "__main__":
    sys.exit(main())
