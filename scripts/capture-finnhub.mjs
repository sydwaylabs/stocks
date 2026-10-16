/**
 * Captures real Finnhub responses as test fixtures, and reports which of the fields the plugin
 * reads are actually present.
 *
 *   FINNHUB_KEY=… node scripts/capture-finnhub.mjs
 *
 * The key is read from the environment and sent as a header; it is never written to a fixture or
 * printed. Run it when Finnhub's responses are suspected of changing shape.
 */
import { writeFileSync } from "node:fs";

const key = process.env.FINNHUB_KEY?.trim();
if (!key) {
  console.error("set FINNHUB_KEY to a Finnhub API key");
  process.exit(2);
}

const OUT = "src/lib/providers/fixtures";
const today = new Date().toISOString().slice(0, 10);
const in90 = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);

async function get(path, params) {
  const url = `https://finnhub.io/api/v1${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { headers: { "X-Finnhub-Token": key, "User-Agent": "Mozilla/5.0 (compatible; SydwayLabsStocks/1.0)" } });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { nonJson: text.slice(0, 200) }; }
  return { status: res.status, body };
}

const captures = [
  ["finnhub-quote-aapl.json", "/quote", { symbol: "AAPL" }],
  ["finnhub-quote-unknown.json", "/quote", { symbol: "ZZZZQ" }],
  ["finnhub-quote-vod-l.json", "/quote", { symbol: "VOD.L" }],
  ["finnhub-profile-aapl.json", "/stock/profile2", { symbol: "AAPL" }],
  ["finnhub-metric-aapl.json", "/stock/metric", { symbol: "AAPL", metric: "all" }],
  ["finnhub-earnings-aapl.json", "/calendar/earnings", { symbol: "AAPL", from: today, to: in90 }],
];

for (const [file, path, params] of captures) {
  const { status, body } = await get(path, params);
  // The metric response has hundreds of fields and a long history series; keep only what is read.
  const keep = path === "/stock/metric" && body?.metric
    ? { metric: Object.fromEntries(Object.entries(body.metric).filter(([k]) =>
        /^(52Week(High|Low)|pe|eps|dividendYield|currentDividendYield|beta)/.test(k))) }
    : body;
  writeFileSync(`${OUT}/${file}`, `${JSON.stringify(keep, null, 1)}\n`);
  console.log(`${String(status).padEnd(4)} ${path.padEnd(20)} ${JSON.stringify(params.symbol)} → ${file}`);
}

const metric = (await get("/stock/metric", { symbol: "AAPL", metric: "all" })).body?.metric ?? {};
const read = ["52WeekHigh", "52WeekLow", "peTTM", "peBasicExclExtraTTM", "epsTTM", "epsBasicExclExtraItemsTTM",
  "dividendYieldIndicatedAnnual", "currentDividendYieldTTM", "beta"];
console.log("\nmetric fields the plugin reads, for AAPL:");
for (const name of read) console.log(`  ${name in metric ? "present" : "missing"}  ${name} = ${metric[name] ?? "—"}`);
