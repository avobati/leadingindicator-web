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
