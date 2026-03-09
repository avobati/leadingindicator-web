import fs from "fs";
import path from "path";

let cachedUniverse: string[] | null = null;

function parseTickerLine(line: string): string | null {
  const tv = String(line || "").trim().toUpperCase();
  if (!tv) return null;
  if (tv.startsWith("#")) return null;
  if (!tv.includes(":")) return null;
  return tv;
}

export function getUniverseSymbols(): string[] {
  if (cachedUniverse) return cachedUniverse;

  const filePath = path.join(process.cwd(), "data", "tickers.csv");
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  const seen = new Set<string>();
  const out: string[] = [];

  for (const line of lines) {
    const parsed = parseTickerLine(line);
    if (!parsed || seen.has(parsed)) continue;
    seen.add(parsed);
    out.push(parsed);
  }

  cachedUniverse = out;
  return out;
}

export function marketFromSymbol(symbol: string): string {
  const i = symbol.indexOf(":");
  if (i <= 0) return "UNKNOWN";
  return symbol.slice(0, i).toUpperCase();
}

export function nameFromSymbol(symbol: string): string {
  const i = symbol.indexOf(":");
  if (i < 0) return symbol;
  return symbol.slice(i + 1);
}
