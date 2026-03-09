import { Pool } from "pg";
import { getUniverseSymbols, marketFromSymbol, nameFromSymbol } from "./universe";

export type SignalRow = {
  symbol: string;
  symbol_name: string;
  market: string;
  timeframe: string;
  signal: string;
  price: string | number | null;
  signal_price: string | number | null;
  bars_ago: number | null;
  ts: string;
  data_quality: "complete" | "inferred" | "missing";
};

type BaseSignalRow = Omit<SignalRow, "symbol_name" | "market" | "data_quality">;

const rawDatabaseUrl = (process.env.DATABASE_URL || "").trim();
const useNoDbMode = !rawDatabaseUrl;
const pool = useNoDbMode ? null : new Pool({ connectionString: rawDatabaseUrl });

function toFiniteNumber(v: string | number | null): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function timeframeDays(tf: string): number {
  const t = String(tf || "").trim().toLowerCase();
  if (t === "daily") return 1;
  if (t === "monthly") return 30;
  return 7;
}

function inferMissingFields(row: BaseSignalRow, allowBarsFromTs: boolean): BaseSignalRow {
  let price = toFiniteNumber(row.price);
  let signalPrice = toFiniteNumber(row.signal_price);
  let barsAgo = row.bars_ago;

  if (price == null && signalPrice != null) price = signalPrice;
  if (signalPrice == null && price != null) signalPrice = price;
  if (price == null && signalPrice == null) {
    // First-run baseline: always return numeric prices for every ticker.
    price = 0;
    signalPrice = 0;
  }

  if ((barsAgo == null || barsAgo < 0) && allowBarsFromTs) {
    const tsMs = Date.parse(row.ts);
    if (Number.isFinite(tsMs) && tsMs > Date.parse("2000-01-01T00:00:00.000Z")) {
      const ageDays = Math.max(0, (Date.now() - tsMs) / 86400000);
      barsAgo = Math.max(1, Math.round(ageDays / timeframeDays(row.timeframe)));
    }
  }
  if (barsAgo == null || barsAgo <= 0) {
    // First-run baseline requested by user.
    barsAgo = 1;
  }

  return {
    ...row,
    price,
    signal_price: signalPrice,
    bars_ago: barsAgo,
  };
}

function classifyDataQuality(before: BaseSignalRow, after: BaseSignalRow): "complete" | "inferred" | "missing" {
  const beforeComplete = before.price != null && before.signal_price != null && before.bars_ago != null;
  const afterComplete = after.price != null && after.signal_price != null && after.bars_ago != null;
  if (beforeComplete) return "complete";
  if (afterComplete) return "inferred";
  return "missing";
}

function baseForSymbol(symbol: string, timeframe: string): BaseSignalRow {
  return {
    symbol,
    timeframe,
    signal: "NEUTRAL",
    price: null,
    signal_price: null,
    bars_ago: null,
    ts: new Date(0).toISOString(),
  };
}

function metaFor(symbol: string): { symbol_name: string; market: string } {
  return {
    symbol_name: nameFromSymbol(symbol),
    market: marketFromSymbol(symbol),
  };
}

export async function runSchemaMigration(): Promise<{ migrated: boolean; hasDb: boolean }> {
  if (!pool) return { migrated: false, hasDb: false };

  const sql = `
    create table if not exists signals (
      id bigserial primary key,
      symbol text not null,
      symbol_name text,
      market text,
      timeframe text not null,
      signal text not null check (signal in ('BUY', 'SELL', 'NEUTRAL')),
      price numeric,
      signal_price numeric,
      bars_ago integer,
      ts timestamptz not null,
      source text,
      created_at timestamptz not null default now(),
      unique(symbol, timeframe, ts)
    );

    create index if not exists idx_signals_symbol_tf_ts on signals(symbol, timeframe, ts desc);
  `;

  await pool.query(sql);
  return { migrated: true, hasDb: true };
}

export async function upsertSignal(input: {
  symbol: string;
  symbol_name?: string | null;
  market?: string | null;
  timeframe: string;
  signal: string;
  price?: number | string | null;
  signal_price?: number | string | null;
  bars_ago?: number | null;
  ts?: string;
  source?: string | null;
}): Promise<{ ok: boolean; hasDb: boolean }> {
  if (!pool) return { ok: false, hasDb: false };

  const symbol = String(input.symbol || "").trim().toUpperCase();
  const timeframe = String(input.timeframe || "weekly").trim().toLowerCase();
  const signal = String(input.signal || "NEUTRAL").trim().toUpperCase();
  const ts = input.ts ? new Date(input.ts).toISOString() : new Date().toISOString();

  const sql = `
    insert into signals(symbol, symbol_name, market, timeframe, signal, price, signal_price, bars_ago, ts, source)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    on conflict (symbol, timeframe, ts)
    do update set
      symbol_name = excluded.symbol_name,
      market = excluded.market,
      signal = excluded.signal,
      price = excluded.price,
      signal_price = excluded.signal_price,
      bars_ago = excluded.bars_ago,
      source = excluded.source
  `;

  await pool.query(sql, [
    symbol,
    String(input.symbol_name || nameFromSymbol(symbol)).trim(),
    String(input.market || marketFromSymbol(symbol)).trim().toUpperCase(),
    timeframe,
    signal === "BUY" || signal === "SELL" ? signal : "NEUTRAL",
    toFiniteNumber(input.price ?? null),
    toFiniteNumber(input.signal_price ?? null),
    input.bars_ago == null ? null : Math.max(1, Math.trunc(Number(input.bars_ago))),
    ts,
    input.source || "tradingview",
  ]);

  return { ok: true, hasDb: true };
}

export async function getLatestSignals(limit = 10000, timeframe = "weekly"): Promise<SignalRow[]> {
  const universeSymbols = getUniverseSymbols();
  const cap = Math.max(1, limit);

  if (!pool) {
    return universeSymbols.slice(0, cap).map((symbol) => {
      const m = metaFor(symbol);
      const raw = baseForSymbol(symbol, timeframe);
      const inferred = inferMissingFields(raw, false);
      return {
        ...inferred,
        data_quality: classifyDataQuality(raw, inferred),
        ...m,
      };
    });
  }

  const sql = `
    select distinct on (s.symbol, s.timeframe)
      s.symbol, s.timeframe, s.signal, s.price, s.signal_price, s.bars_ago, s.ts
    from signals s
    where s.timeframe = $1
    order by s.symbol, s.timeframe, s.ts desc
  `;

  const { rows } = await pool.query(sql, [timeframe]);
  const latest = new Map<string, BaseSignalRow>();
  for (const r of rows as BaseSignalRow[]) {
    latest.set(String(r.symbol).toUpperCase(), r);
  }

  return universeSymbols.slice(0, cap).map((symbol) => {
    const m = metaFor(symbol);
    const raw = latest.get(symbol) || baseForSymbol(symbol, timeframe);
    const inferred = inferMissingFields(raw, Boolean(latest.get(symbol)));
    return {
      ...inferred,
      data_quality: classifyDataQuality(raw, inferred),
      ...m,
    };
  });
}
