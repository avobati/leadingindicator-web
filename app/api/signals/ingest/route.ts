import { upsertSignal } from "../../../../lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function toSignal(value: string): "BUY" | "SELL" | "NEUTRAL" {
  const signal = String(value || "").trim().toUpperCase();
  if (signal === "BUY") return "BUY";
  if (signal === "SELL") return "SELL";
  return "NEUTRAL";
}

export async function POST(request: Request) {
  const body = await request.json();
  const symbol = String(body.symbol || body.ticker || "").trim().toUpperCase();

  if (!symbol) {
    return Response.json({ ok: false, error: "Missing symbol" }, { status: 400 });
  }

  const result = await upsertSignal({
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
  });

  return Response.json(result);
}
