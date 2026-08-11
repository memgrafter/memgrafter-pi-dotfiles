#!/usr/bin/env python3
"""Patch zero-cost usage records in pi's rounds.jsonl metrics file.

pi computes usage cost client-side in calculateCost() (pi-ai dist/models.js):
    cost.X = (rate.X / 1_000_000) * usage.X      for X in input/output/cacheRead
    cost.cacheWrite = (rate.cacheWrite * shortWrite + rate.input * 2 * longWrite) / 1_000_000
    total = sum of parts
Rates come from the model definition. The local deepseek provider config
previously lacked a "cost" field, so pi recorded $0 for every round. This
script backfills those records with the same calculation pi itself would have
performed, using the rates pi's model store publishes.

Rate table: snapshot of api.deepseek.com store (models-store.json), Aug 2026.
Extend with --rates-file for other models. Idempotent: skips already-priced
cost objects (any non-zero field). Safe on a live file: retries if the file
changes during the patch, writes atomically, and verifies after writing.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

DEFAULT_PATH = Path.home() / ".pi" / "agent" / "metrics" / "rounds.jsonl"
DEFAULT_BACKUP_DIR = Path.home() / "backups"

# Per-1M-token rates ($). Snapshot of pi's remote model store, Aug 2026.
DEFAULT_RATES: dict[str, dict] = {
    "deepseek-v4-flash": {"input": 0.14, "output": 0.28, "cacheRead": 0.0028, "cacheWrite": 0},
    "deepseek-v4-pro": {"input": 0.435, "output": 0.87, "cacheRead": 0.003625, "cacheWrite": 0},
}

COST_FIELDS = ("input", "output", "cacheRead", "cacheWrite")


def _select_rates(cost_cfg: dict, usage: dict) -> dict:
    """Mirror pi's tier selection: highest tier whose inputTokensAbove is exceeded."""
    input_tokens = usage.get("input", 0) + usage.get("cacheRead", 0) + usage.get("cacheWrite", 0)
    rates = cost_cfg
    matched_threshold = -1
    for tier in cost_cfg.get("tiers") or []:
        above = tier.get("inputTokensAbove", 0)
        if input_tokens > above and above > matched_threshold:
            rates = tier
            matched_threshold = above
    return rates


def calculate_cost(usage: dict, model: str, rates: dict[str, dict]) -> dict | None:
    """Compute the cost object pi's calculateCost would produce. None if unknown model."""
    cost_cfg = rates.get(model)
    if cost_cfg is None:
        return None
    rates_sel = _select_rates(cost_cfg, usage)
    # Anthropic-style 1h cache-write pricing (unused by deepseek, mirrors pi exactly).
    long_write = usage.get("cacheWrite1h", 0)
    short_write = usage.get("cacheWrite", 0) - long_write
    cost = {
        "input": (rates_sel["input"] / 1_000_000) * usage.get("input", 0),
        "output": (rates_sel["output"] / 1_000_000) * usage.get("output", 0),
        "cacheRead": (rates_sel["cacheRead"] / 1_000_000) * usage.get("cacheRead", 0),
        "cacheWrite": (rates_sel["cacheWrite"] * short_write + rates_sel["input"] * 2 * long_write) / 1_000_000,
    }
    cost["total"] = cost["input"] + cost["output"] + cost["cacheRead"] + cost["cacheWrite"]
    return cost


def is_zero(cost: dict) -> bool:
    return not any(cost.get(k) for k in COST_FIELDS)


def patch_cost_object(cost: dict, usage: dict, model: str, rates: dict[str, dict]) -> str:
    """Patch one cost object in place. Returns outcome: patched|already|unknown|empty."""
    if not is_zero(cost):
        return "already"
    if not any(usage.get(k) for k in COST_FIELDS):
        return "empty"  # genuinely zero-usage round (e.g. aborted); stays zero
    new_cost = calculate_cost(usage, model, rates)
    if new_cost is None:
        return "unknown"
    cost.update(new_cost)
    return "patched"


def patch_record(record: dict, rates: dict[str, dict], stats: dict) -> None:
    """Patch top-level cost and every turn's usage.cost in one record."""
    model = record.get("model")
    if not model:
        stats["no_model"] += 1
        return
    if "cost" in record:
        outcome = patch_cost_object(record["cost"], record.get("usage") or {}, model, rates)
        stats[outcome] += 1
    for turn in record.get("turns") or []:
        turn_usage = turn.get("usage")
        if isinstance(turn_usage, dict) and "cost" in turn_usage:
            outcome = patch_cost_object(turn_usage["cost"], turn_usage, model, rates)
            stats[outcome] += 1


def load_records(text: str) -> list[dict]:
    return [json.loads(line) for line in text.splitlines() if line.strip()]


def dump_records(records: list[dict]) -> str:
    return "\n".join(json.dumps(r, separators=(",", ":")) for r in records) + "\n"


def verify(path: Path, rates: dict[str, dict], tolerance: float = 1e-9) -> tuple[int, int, list[str]]:
    """Re-read the file; confirm every priced object matches our calculation.

    Returns (checked, unpatched, problems). "checked" = priced objects that
    matched the rate table; "unpatched" = zero-cost objects with non-zero
    usage (the patch backlog); "problems" = priced objects that disagree with
    the rate table (real failures).
    """
    records = load_records(path.read_text())
    problems: list[str] = []
    checked = 0
    unpatched = 0
    for i, rec in enumerate(records):
        model = rec.get("model")
        if not model:
            continue
        for where, cost, usage in walk_cost_objects(rec):
            expected = calculate_cost(usage, model, rates)
            if expected is None:
                continue
            if is_zero(cost) and any(usage.get(k) for k in COST_FIELDS):
                unpatched += 1
                continue
            if not is_zero(cost):
                checked += 1
                for k in ("input", "output", "cacheRead", "cacheWrite", "total"):
                    if abs(cost.get(k, 0) - expected[k]) > tolerance:
                        problems.append(
                            f"line {i}: {where} cost.{k}={cost.get(k)} != expected {expected[k]}"
                        )
    return checked, unpatched, problems


def walk_cost_objects(record: dict):
    if "cost" in record:
        yield "cost", record["cost"], record.get("usage") or {}
    for i, turn in enumerate(record.get("turns") or []):
        turn_usage = turn.get("usage")
        if isinstance(turn_usage, dict) and "cost" in turn_usage:
            yield f"turns[{i}].usage.cost", turn_usage["cost"], turn_usage


def read_stable(path: Path, max_attempts: int = 5) -> tuple[str, int]:
    """Read the file, retrying if it grows (pi appends live) between read and stat."""
    for attempt in range(max_attempts):
        before = path.stat().st_size
        text = path.read_text()
        time.sleep(0.05)
        after = path.stat().st_size
        if after == before:
            return text, after
        print(f"  file changed during read (size {before} -> {after}); retrying ({attempt + 1}/{max_attempts})")
    raise RuntimeError(f"{path} keeps changing; refusing to patch a moving file")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--path", type=Path, default=DEFAULT_PATH)
    parser.add_argument("--backup-dir", type=Path, default=DEFAULT_BACKUP_DIR)
    parser.add_argument("--rates-file", type=Path, help="optional JSON of model -> rates, merged over defaults")
    parser.add_argument("--dry-run", action="store_true", help="report what would change, write nothing")
    parser.add_argument("--no-backup", action="store_true", help="skip the timestamped backup copy")
    parser.add_argument("--verify", action="store_true", help="only verify the file, do not patch")
    args = parser.parse_args()

    rates = {k: dict(v) for k, v in DEFAULT_RATES.items()}
    if args.rates_file:
        rates.update(json.loads(args.rates_file.read_text()))

    if args.verify:
        checked, unpatched, problems = verify(args.path, rates)
        for p in problems[:20]:
            print(f"  {p}")
        if problems:
            print(f"VERIFY FAILED: {len(problems)} priced object(s) disagree with the rate table")
            return 1
        print(f"verify ok: {checked} priced cost objects match the rate table; {unpatched} still unpatched")
        return 0

    text, _ = read_stable(args.path)
    records = load_records(text)
    stats = {"patched": 0, "already": 0, "empty": 0, "unknown": 0, "no_model": 0}
    for rec in records:
        patch_record(rec, rates, stats)

    print(f"records scanned: {len(records)}")
    print(f"cost objects: patched={stats['patched']} already_priced={stats['already']} "
          f"zero_usage={stats['empty']} unknown_model={stats['unknown']} no_model={stats['no_model']}")

    if args.dry_run:
        return 0

    if stats["patched"] == 0:
        print("nothing to patch")
        return 0

    backup_path = None
    if not args.no_backup:
        ts = time.strftime("%Y-%m-%d_%H-%M-%S")
        backup_path = args.backup_dir / f"rounds.jsonl_{ts}.bak"
        args.backup_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(args.path, backup_path)

    fd, tmp = tempfile.mkstemp(dir=args.path.parent, prefix=".rounds.jsonl.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as fh:
            fh.write(dump_records(records))
        os.replace(tmp, args.path)
    except BaseException:
        os.unlink(tmp)
        raise

    print(f"backup: {backup_path}" if backup_path else "backup: skipped")
    print(f"patched: {args.path}")

    checked, unpatched, problems = verify(args.path, rates)
    for p in problems[:20]:
        print(f"  {p}")
    if problems:
        print(f"POST-WRITE VERIFY FAILED: {len(problems)} priced object(s) disagree with the rate table")
        return 1
    if unpatched:
        print(f"POST-WRITE VERIFY FAILED: {unpatched} zero-cost object(s) remain with non-zero usage")
        return 1
    print(f"post-write verify ok: {checked} priced cost objects match the rate table; none unpatched")
    return 0


if __name__ == "__main__":
    sys.exit(main())
