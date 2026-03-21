#!/usr/bin/env python3
"""
Sync weekly WaveTrend crossover signals from TradingView into Neon.

Rules:
- BUY when green (wt1) crosses above red (wt2)
- SELL when green crosses below red
- bars_ago counts candles from the latest live weekly bar:
  current in-progress weekly crossover = 0, prior bar = 1, two bars ago = 2
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd
import psycopg
from tvDatafeed import Interval, TvDatafeed


ROOT = Path(__file__).resolve().parents[1]
TICKERS_PATH = ROOT / "data" / "tickers.csv"
DEFAULT_TIMEFRAME = "weekly"
DEFAULT_INGEST_URL = "https://leadingindicator-web.vercel.app/api/signals/ingest"


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


def load_symbols(limit: int | None, start_index: int = 0) -> list[str]:
    all_symbols: list[str] = []
    seen: set[str] = set()
    with TICKERS_PATH.open("r", encoding="utf-8") as f:
        for raw in f:
            tv = raw.strip().upper()
            if not tv or ":" not in tv:
                continue
            if tv in seen:
                continue
            seen.add(tv)
            all_symbols.append(tv)

    sliced = all_symbols[max(0, start_index) :]
    if limit is None:
        return sliced
    return sliced[: max(0, limit)]


def ema(series: pd.Series, span: int) -> pd.Series:
    return series.ewm(span=span, adjust=False).mean()


def compute_wavetrend(df: pd.DataFrame, n1: int = 10, n2: int = 21) -> tuple[pd.Series, pd.Series]:
    hlc3 = (df["high"] + df["low"] + df["close"]) / 3.0
    esa = ema(hlc3, n1)
    d = ema((hlc3 - esa).abs(), n1)
    d = d.replace(0, np.nan)
    ci = (hlc3 - esa) / (0.015 * d)
    wt1 = ema(ci, n2)
    wt2 = wt1.rolling(4).mean()
    return wt1, wt2


def build_signal(df: pd.DataFrame) -> dict | None:
    if df is None or len(df) < 40:
        return None

    clean = df.dropna(subset=["open", "high", "low", "close"]).copy()
    if len(clean) < 40:
        return None

    wt1, wt2 = compute_wavetrend(clean)
    diff = wt1 - wt2
    prev = diff.shift(1)
    cross_up = (diff > 0) & (prev <= 0)
    cross_down = (diff < 0) & (prev >= 0)
    events = clean.index[(cross_up | cross_down).fillna(False)]

    last_close = float(clean["close"].iloc[-1])
    last_ts = clean.index[-1]

    if len(events) == 0:
        signal = "NEUTRAL"
        bars_ago = 1
        signal_price = float(clean["close"].iloc[-2] if len(clean) > 1 else clean["close"].iloc[-1])
    else:
        event_ts = events[-1]
        event_pos = clean.index.get_loc(event_ts)
        bars_ago = max(0, int(len(clean) - 1 - event_pos))
        signal = "BUY" if bool(cross_up.loc[event_ts]) else "SELL"
        signal_price = float(clean["close"].iloc[event_pos])

    return {
        "signal": signal,
        "price": round(last_close, 6),
        "signal_price": round(signal_price, 6),
        "bars_ago": bars_ago,
        "ts": pd.Timestamp(last_ts).to_pydatetime().isoformat(),
    }


def rows_to_payload(rows: list[tuple]) -> list[dict]:
    payloads: list[dict] = []
    for row in rows:
        payloads.append(
            {
                "symbol": row[0],
                "symbol_name": row[1],
                "market": row[2],
                "timeframe": row[3],
                "signal": row[4],
                "price": row[5],
                "signal_price": row[6],
                "bars_ago": row[7],
                "ts": row[8],
                "source": row[9],
            }
        )
    return payloads


def upsert_rows(conn: psycopg.Connection, rows: list[tuple]) -> None:
    if not rows:
        return
    sql = """
        insert into signals(symbol, symbol_name, market, timeframe, signal, price, signal_price, bars_ago, ts, source)
        values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        on conflict (symbol, timeframe, ts)
        do update set
          symbol_name = excluded.symbol_name,
          market = excluded.market,
          signal = excluded.signal,
          price = excluded.price,
          signal_price = excluded.signal_price,
          bars_ago = excluded.bars_ago,
          source = excluded.source
    """
    with conn.cursor() as cur:
        cur.executemany(sql, rows)
    conn.commit()


def post_rows(ingest_url: str, rows: list[tuple]) -> None:
    if not rows:
        return

    payload = json.dumps({"items": rows_to_payload(rows)}).encode("utf-8")
    request = urllib.request.Request(
        ingest_url,
        data=payload,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        raw = response.read().decode("utf-8")
        body = json.loads(raw or "{}")
        if response.status >= 400 or not body.get("ok"):
            raise RuntimeError(f"HTTP ingest failed: status={response.status} body={raw}")


def flush_rows(conn: psycopg.Connection | None, ingest_url: str | None, rows: list[tuple]) -> None:
    if conn is not None:
        upsert_rows(conn, rows)
        return
    if ingest_url:
        post_rows(ingest_url, rows)
        return
    raise RuntimeError("No write target available for signal sync")


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync TradingView weekly WaveTrend crossovers into Neon")
    parser.add_argument("--limit", type=int, default=300, help="Max symbols to sync (default: 300)")
    parser.add_argument("--start-index", type=int, default=0, help="Start offset in ticker list")
    parser.add_argument("--batch-size", type=int, default=10, help="DB upsert batch size (default: 10)")
    parser.add_argument("--pause-ms", type=int, default=150, help="Pause between symbols to reduce 429 risk")
    parser.add_argument(
        "--symbols",
        type=str,
        default="",
        help="Comma-separated TradingView symbols (overrides ticker list), e.g. NASDAQ:ANTX,NASDAQ:AAPL",
    )
    args = parser.parse_args()

    load_env_local()
    database_url = (os.environ.get("DATABASE_URL") or "").strip()
    ingest_url = (os.environ.get("SIGNALS_INGEST_URL") or DEFAULT_INGEST_URL).strip() or None
    conn: psycopg.Connection | None = None

    if database_url:
        try:
            conn = psycopg.connect(database_url)
        except psycopg.OperationalError as exc:
            if not ingest_url:
                raise
            print(f"db_connect_failed={exc}; falling back to ingest_url={ingest_url}", file=sys.stderr, flush=True)
    elif not ingest_url:
        raise SystemExit("Missing DATABASE_URL or SIGNALS_INGEST_URL")

    if args.symbols.strip():
        symbols = [s.strip().upper() for s in args.symbols.split(",") if ":" in s.strip()]
    else:
        symbols = load_symbols(args.limit if args.limit > 0 else None, start_index=max(0, args.start_index))
    tv = TvDatafeed()

    done = 0
    ok = 0
    rows: list[tuple] = []

    try:
        for tv_symbol in symbols:
            done += 1
            exchange, symbol_name = tv_symbol.split(":", 1)
            payload = None
            for attempt in range(3):
                try:
                    df = tv.get_hist(symbol=symbol_name, exchange=exchange, interval=Interval.in_weekly, n_bars=130)
                    payload = build_signal(df)
                    break
                except Exception:
                    time.sleep(1.5 * (attempt + 1))
            if payload is None:
                continue

            ok += 1
            rows.append(
                (
                    tv_symbol,
                    symbol_name,
                    exchange,
                    DEFAULT_TIMEFRAME,
                    payload["signal"],
                    payload["price"],
                    payload["signal_price"],
                    payload["bars_ago"],
                    payload["ts"],
                    "tradingview_live_wavetrend",
                )
            )

            if len(rows) >= args.batch_size:
                flush_rows(conn, ingest_url, rows)
                rows.clear()

            if done % 10 == 0:
                print(f"processed={done} synced={ok}", flush=True)

            time.sleep(max(0, args.pause_ms) / 1000.0)

        if rows:
            flush_rows(conn, ingest_url, rows)
    finally:
        if conn is not None:
            conn.close()

    print(f"done={done} synced={ok}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
