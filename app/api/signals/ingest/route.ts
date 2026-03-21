import { upsertSignal } from "../../../../lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function toSignal(value: string): "BUY" | "SELL" | "NEUTRAL" {
  const signal = String(value || "").trim().toUpperCase();
  if (signal === "BUY") return "BUY";
  if (signal === "SELL") return "SELL";
  return "NEUTRAL";
}

type IngestItem = {
  symbol?: string;
  ticker?: string;
  symbol_name?: string | null;
  market?: string | null;
  timeframe?: string;
  signal?: string;
  side?: string;
  price?: number | string | null;
  signal_price?: number | string | null;
  signalPrice?: number | string | null;
  bars_ago?: number | null;
  barsAgo?: number | null;
  ts?: string;
  timestamp?: string;
  source?: string | null;
};

function normalizeItem(body: IngestItem) {
  const symbol = String(body.symbol || body.ticker || "").trim().toUpperCase();
  return {
    symbol,
    symbol_name: body.symbol_name ?? null,
    market: body.market ?? null,
    timeframe: String(body.timeframe || "weekly").trim().toLowerCase(),
    signal: toSignal(String(body.signal || body.side || "NEUTRAL")),
    price: body.price ?? null,
    signal_price: body.signal_price ?? body.signalPrice ?? null,
    bars_ago: body.bars_ago ?? body.barsAgo ?? null,
    ts: body.ts ?? body.timestamp ?? new Date().toISOString(),
    source: body.source ?? "tradingview",
  };
}

export async function POST(request: Request) {
  const body = await request.json();
  const items: IngestItem[] = Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : [body];
  const payloads = items.map((item: IngestItem) => normalizeItem(item));

  if (payloads.some((item) => !item.symbol)) {
    return Response.json({ ok: false, error: "Missing symbol" }, { status: 400 });
  }

  const results = [];
  for (const item of payloads) {
    results.push(await upsertSignal(item));
  }

  const hasDb = results.every((result) => result.hasDb);
  const ok = results.every((result) => result.ok);
  return Response.json({ ok, hasDb, count: results.length });
}
