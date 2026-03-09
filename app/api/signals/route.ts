import { getLatestSignals } from "../../../lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const timeframe = searchParams.get("timeframe") || "weekly";
  const limit = Number(searchParams.get("limit") || "10000");
  const rows = await getLatestSignals(limit, timeframe);
  const items = rows.map((row) => ({
    ...row,
    current_price: row.price,
  }));
  return Response.json({ ok: true, timeframe, count: items.length, items });
}
