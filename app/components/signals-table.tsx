"use client";

import { useMemo, useState } from "react";

export type SignalRow = {
  symbol: string;
  symbol_name: string;
  market: string;
  timeframe: string;
  signal: string;
  price: number | string | null;
  signal_price: number | string | null;
  bars_ago: number | null;
  ts: string;
};

function tvChartUrl(symbol: string): string {
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`;
}

function shortSymbol(tvSymbol: string): string {
  const i = tvSymbol.indexOf(":");
  return i > -1 ? tvSymbol.slice(i + 1) : tvSymbol;
}

function badgeClass(signal: string): string {
  const s = signal.toUpperCase();
  if (s === "BUY") return "badge buy";
  if (s === "SELL") return "badge sell";
  return "badge neutral";
}

function sortAsc(values: string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function formatPrice(v: number | string | null): string {
  if (v == null || v === "") return "-";
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  return n.toFixed(2);
}

export default function SignalsTable({ rows }: { rows: SignalRow[] }) {
  const [symbolFilter, setSymbolFilter] = useState("ALL");
  const [nameFilter, setNameFilter] = useState("");
  const [marketFilter, setMarketFilter] = useState("ALL");
  const [timeframeFilter, setTimeframeFilter] = useState("ALL");
  const [signalFilter, setSignalFilter] = useState("ALL");
  const [barsFilter, setBarsFilter] = useState("ALL");
  const [signalPriceOrder, setSignalPriceOrder] = useState("none");
  const [priceOrder, setPriceOrder] = useState("none");

  const symbolOptions = useMemo(
    () => sortAsc(Array.from(new Set(rows.map((r) => shortSymbol(r.symbol).trim().toUpperCase())))),
    [rows]
  );
  const marketOptions = useMemo(
    () => sortAsc(Array.from(new Set(rows.map((r) => String(r.market || "UNKNOWN").trim().toUpperCase())))),
    [rows]
  );
  const timeframeOptions = useMemo(
    () => sortAsc(Array.from(new Set(rows.map((r) => r.timeframe.trim().toLowerCase())))),
    [rows]
  );

  const filtered = useMemo(() => {
    let data = rows.filter((r) => {
      const symbol = shortSymbol(r.symbol).trim().toUpperCase();
      const name = String(r.symbol_name || "").trim();
      const market = String(r.market || "UNKNOWN").trim().toUpperCase();
      const timeframe = r.timeframe.trim().toLowerCase();
      const signal = r.signal.trim().toUpperCase();

      if (symbolFilter !== "ALL" && symbol !== symbolFilter) return false;
      if (nameFilter && !name.toLowerCase().includes(nameFilter.toLowerCase())) return false;
      if (marketFilter !== "ALL" && market !== marketFilter) return false;
      if (timeframeFilter !== "ALL" && timeframe !== timeframeFilter) return false;
      if (signalFilter !== "ALL" && signal !== signalFilter) return false;
      if (barsFilter === "0" && r.bars_ago !== 0) return false;
      if (barsFilter === "1-3" && (r.bars_ago == null || r.bars_ago < 1 || r.bars_ago > 3)) return false;
      if (barsFilter === "4+" && (r.bars_ago == null || r.bars_ago < 4)) return false;
      return true;
    });

    if (signalPriceOrder !== "none") {
      data = [...data].sort((a, b) => {
        const av = Number(a.signal_price ?? Number.NEGATIVE_INFINITY);
        const bv = Number(b.signal_price ?? Number.NEGATIVE_INFINITY);
        return signalPriceOrder === "asc" ? av - bv : bv - av;
      });
    }

    if (priceOrder !== "none") {
      data = [...data].sort((a, b) => {
        const av = Number(a.price ?? Number.NEGATIVE_INFINITY);
        const bv = Number(b.price ?? Number.NEGATIVE_INFINITY);
        return priceOrder === "asc" ? av - bv : bv - av;
      });
    }

    return data;
  }, [barsFilter, marketFilter, nameFilter, priceOrder, rows, signalFilter, signalPriceOrder, symbolFilter, timeframeFilter]);

  return (
    <section className="panel table-wrap">
      <table className="signals-table">
        <thead>
          <tr>
            <th>
              Symbol
              <br />
              <select value={symbolFilter} onChange={(e) => setSymbolFilter(e.target.value)}>
                <option value="ALL">All</option>
                {symbolOptions.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </th>
            <th>
              Symbol Name
              <br />
              <input
                type="text"
                value={nameFilter}
                onChange={(e) => setNameFilter(e.target.value)}
                placeholder="Search name..."
              />
            </th>
            <th>
              Market
              <br />
              <select value={marketFilter} onChange={(e) => setMarketFilter(e.target.value)}>
                <option value="ALL">All</option>
                {marketOptions.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </th>
            <th>
              Timeframe
              <br />
              <select value={timeframeFilter} onChange={(e) => setTimeframeFilter(e.target.value)}>
                <option value="ALL">All</option>
                {timeframeOptions.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </th>
            <th>
              Signal
              <br />
              <select value={signalFilter} onChange={(e) => setSignalFilter(e.target.value)}>
                <option value="ALL">All</option>
                <option value="BUY">BUY</option>
                <option value="SELL">SELL</option>
                <option value="NEUTRAL">NEUTRAL</option>
              </select>
            </th>
            <th>
              Candles Ago
              <br />
              <select value={barsFilter} onChange={(e) => setBarsFilter(e.target.value)}>
                <option value="ALL">All</option>
                <option value="0">0</option>
                <option value="1-3">1-3</option>
                <option value="4+">4+</option>
              </select>
            </th>
            <th>
              Signal Price
              <br />
              <select value={signalPriceOrder} onChange={(e) => setSignalPriceOrder(e.target.value)}>
                <option value="none">None</option>
                <option value="asc">Low-High</option>
                <option value="desc">High-Low</option>
              </select>
            </th>
            <th>
              Current Price
              <br />
              <select value={priceOrder} onChange={(e) => setPriceOrder(e.target.value)}>
                <option value="none">None</option>
                <option value="asc">Low-High</option>
                <option value="desc">High-Low</option>
              </select>
            </th>
            <th>
              TV
              <br />
              <select value="open" disabled>
                <option>Link</option>
              </select>
            </th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((s, idx) => (
            <tr key={`${s.symbol}-${s.timeframe}-${s.ts}-${idx}`}>
              <td>{shortSymbol(s.symbol)}</td>
              <td className="symbol-name-col" title={s.symbol_name || shortSymbol(s.symbol)}>{s.symbol_name || shortSymbol(s.symbol)}</td>
              <td>{s.market || "UNKNOWN"}</td>
              <td>{s.timeframe}</td>
              <td><span className={badgeClass(s.signal)}>{s.signal}</span></td>
              <td>{s.bars_ago ?? "-"}</td>
              <td>{formatPrice(s.signal_price)}</td>
              <td>{formatPrice(s.price)}</td>
              <td>
                <a className="tv-link" href={tvChartUrl(s.symbol)} target="_blank" rel="noreferrer">
                  Open
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

