#!/usr/bin/env python3
"""
Retry weekly WaveTrend sync for only stale or missing symbols in the current week.

This script keeps batching the current stale set until either:
- every universe symbol has a fresh weekly row for the current week, or
- coverage stops improving across passes.
"""

from __future__ import annotations

import argparse
import math
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg


ROOT = Path(__file__).resolve().parents[1]
SYNC_SCRIPT = ROOT / "scripts" / "sync_tradingview_wavetrend.py"
TICKERS_PATH = ROOT / "data" / "tickers.csv"


def load_env_local() -> None:
    env_path = ROOT / ".env.local"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        value = value.replace("\\r\\n", "").replace("\\n", "").strip()
        if key and key not in os.environ:
            os.environ[key] = value


def load_universe_symbols() -> list[str]:
    seen: set[str] = set()
    symbols: list[str] = []
    with TICKERS_PATH.open("r", encoding="utf-8") as f:
        for raw in f:
            tv = raw.strip().upper()
            if not tv or ":" not in tv or tv in seen:
                continue
            seen.add(tv)
            symbols.append(tv)
    return symbols


def monday_utc_now() -> datetime:
    now = datetime.now(timezone.utc)
    return (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)


def latest_rows(conn: psycopg.Connection, timeframe: str) -> dict[str, datetime]:
    sql = """
        select distinct on (symbol) symbol, ts
        from signals
        where timeframe = %s
        order by symbol, ts desc
    """
    out: dict[str, datetime] = {}
    with conn.cursor() as cur:
        cur.execute(sql, (timeframe,))
        for symbol, ts in cur.fetchall():
            out[str(symbol).upper()] = ts
    return out


def stale_symbols(conn: psycopg.Connection, universe: list[str], timeframe: str, fresh_since: datetime) -> list[str]:
    latest = latest_rows(conn, timeframe)
    stale: list[str] = []
    for symbol in universe:
        ts = latest.get(symbol)
        if ts is None or ts < fresh_since:
            stale.append(symbol)
    return stale


def chunks(values: list[str], size: int) -> list[list[str]]:
    return [values[i : i + size] for i in range(0, len(values), size)]


def run_batch(symbols: list[str], pause_ms: int) -> int:
    env = os.environ.copy()
    cmd = [
        sys.executable,
        str(SYNC_SCRIPT),
        "--symbols",
        ",".join(symbols),
        "--batch-size",
        str(max(1, min(100, len(symbols)))),
        "--pause-ms",
        str(max(0, pause_ms)),
    ]
    return subprocess.run(cmd, cwd=str(ROOT), env=env).returncode


def main() -> int:
    parser = argparse.ArgumentParser(description="Retry stale current-week weekly sync batches")
    parser.add_argument("--timeframe", type=str, default="weekly")
    parser.add_argument("--symbol-batch-size", type=int, default=50)
    parser.add_argument("--pause-ms", type=int, default=100)
    parser.add_argument("--max-passes", type=int, default=10)
    parser.add_argument("--sleep-between-passes", type=float, default=2.0)
    args = parser.parse_args()

    load_env_local()
    database_url = (os.environ.get("DATABASE_URL") or "").strip()
    if not database_url:
        raise SystemExit("Missing DATABASE_URL (set in .env.local or environment)")

    universe = load_universe_symbols()
    fresh_since = monday_utc_now()
    batch_size = max(1, args.symbol_batch_size)
    last_stale_count: int | None = None

    print(
        f"universe={len(universe)} timeframe={args.timeframe} fresh_since={fresh_since.isoformat()} "
        f"symbol_batch_size={batch_size} max_passes={args.max_passes}",
        flush=True,
    )

    with psycopg.connect(database_url) as conn:
        for pass_no in range(1, max(1, args.max_passes) + 1):
            stale = stale_symbols(conn, universe, args.timeframe, fresh_since)
            stale_count = len(stale)
            fresh_count = len(universe) - stale_count
            print(f"pass={pass_no} fresh={fresh_count} stale={stale_count}", flush=True)

            if stale_count == 0:
                print("all symbols are fresh for the current week", flush=True)
                return 0

            if last_stale_count is not None and stale_count >= last_stale_count:
                print("coverage stopped improving; stopping retries", flush=True)
                return 2

            last_stale_count = stale_count
            groups = chunks(stale, batch_size)
            total_groups = len(groups)
            for index, group in enumerate(groups, start=1):
                print(
                    f"pass={pass_no} batch={index}/{total_groups} symbols={len(group)} "
                    f"first={group[0]} last={group[-1]}",
                    flush=True,
                )
                code = run_batch(group, args.pause_ms)
                print(f"pass={pass_no} batch={index}/{total_groups} exit={code}", flush=True)

            time.sleep(max(0.0, args.sleep_between_passes))

        final_stale = stale_symbols(conn, universe, args.timeframe, fresh_since)
        print(f"finished max_passes with stale={len(final_stale)}", flush=True)
        return 0 if not final_stale else 3


if __name__ == "__main__":
    raise SystemExit(main())
