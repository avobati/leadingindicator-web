# Leadingindicator Web

Standalone dashboard app for weekly WaveTrend recommendations.

- Uses Neon Postgres through `DATABASE_URL`
- Vercel-ready Next.js app
- Uses the weeklytop5 ticker universe copied to `data/tickers.csv`
- Uses the same ranking criteria as weeklytop5 for BUY and SELL recommendations

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open:

- `/` main dashboard
- `/recommendations` BUY ranking
- `/recommendations/sell` SELL ranking

## Neon setup

1. Create a Neon database.
2. Add `DATABASE_URL` in `.env.local`.
3. Apply `data/schema.sql` in Neon SQL editor, or open `/api/health` once to auto-create the table.

## Signal ingestion webhook

POST to `/api/signals/ingest` with JSON:

```json
{
  "symbol": "NASDAQ:AAPL",
  "timeframe": "weekly",
  "signal": "BUY",
  "price": 212.34,
  "signal_price": 209.1,
  "bars_ago": 0,
  "ts": "2026-03-10T00:00:00.000Z",
  "source": "wavetrend"
}
```

## Deploy on Vercel

1. Import `C:\\Users\\avoba\\Leadingindicator\\web` as a Vercel project.
2. Set environment variable `DATABASE_URL`.
3. Deploy.
