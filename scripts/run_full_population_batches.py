#!/usr/bin/env python3
"""
Run TradingView WaveTrend sync in sequential batches across the full ticker universe.

This wrapper calls `sync_tradingview_wavetrend.py` repeatedly with start-index/limit
and persists progress to a checkpoint JSON so runs can resume.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SYNC_SCRIPT = ROOT / "scripts" / "sync_tradingview_wavetrend.py"
TICKERS_PATH = ROOT / "data" / "tickers.csv"
CHECKPOINT_PATH = ROOT / "data" / "sync_checkpoint.json"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_total_symbols() -> int:
    seen: set[str] = set()
    with TICKERS_PATH.open("r", encoding="utf-8") as f:
        for raw in f:
            tv = raw.strip().upper()
            if not tv or ":" not in tv:
                continue
            seen.add(tv)
    return len(seen)


def load_checkpoint() -> dict:
    if not CHECKPOINT_PATH.exists():
        return {}
    try:
        return json.loads(CHECKPOINT_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_checkpoint(payload: dict) -> None:
    CHECKPOINT_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Run full TradingView sync in batches")
    parser.add_argument("--batch-size", type=int, default=300, help="Symbols per batch (default: 300)")
    parser.add_argument("--pause-ms", type=int, default=200, help="Per-symbol pause passed to sync script")
    parser.add_argument("--start-index", type=int, default=-1, help="Override start index; -1 uses checkpoint")
    parser.add_argument("--max-batches", type=int, default=0, help="Stop after N batches (0 = no limit)")
    parser.add_argument("--sleep-between-sec", type=float, default=2.0, help="Sleep between batches")
    parser.add_argument("--continue-on-error", action="store_true", help="Continue even if one batch fails")
    args = parser.parse_args()

    total = load_total_symbols()
    checkpoint = load_checkpoint()
    checkpoint_total = int(checkpoint.get("total_symbols", 0) or 0)
    next_index = int(checkpoint.get("next_index", 0))
    if args.start_index >= 0:
        next_index = args.start_index
    elif next_index >= total or (checkpoint_total and checkpoint_total != total):
        # A completed or stale checkpoint should restart from the beginning on the next daily run.
        next_index = 0

    batch_size = max(1, args.batch_size)
    batches_run = 0

    print(f"[{utc_now_iso()}] total_symbols={total} start_index={next_index} batch_size={batch_size}", flush=True)

    while next_index < total:
        if args.max_batches > 0 and batches_run >= args.max_batches:
            print(f"[{utc_now_iso()}] reached max_batches={args.max_batches}; stopping", flush=True)
            break

        cmd = [
            sys.executable,
            str(SYNC_SCRIPT),
            "--start-index",
            str(next_index),
            "--limit",
            str(batch_size),
            "--pause-ms",
            str(max(0, args.pause_ms)),
        ]
        print(f"[{utc_now_iso()}] batch_start={next_index} cmd={' '.join(cmd)}", flush=True)
        result = subprocess.run(cmd, cwd=str(ROOT))

        next_index += batch_size
        batches_run += 1
        cp = {
            "next_index": next_index,
            "total_symbols": total,
            "last_exit_code": result.returncode,
            "last_run_at": utc_now_iso(),
            "batches_run": batches_run,
        }
        save_checkpoint(cp)
        print(f"[{utc_now_iso()}] batch_done exit={result.returncode} next_index={next_index}", flush=True)

        if result.returncode != 0 and not args.continue_on_error:
            print(f"[{utc_now_iso()}] stopping on error (use --continue-on-error to continue)", flush=True)
            return result.returncode

        time.sleep(max(0.0, args.sleep_between_sec))

    print(f"[{utc_now_iso()}] finished all batches or reached stop condition", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
