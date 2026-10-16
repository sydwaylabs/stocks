import { getJson, type Fetch } from "./http.js";
import { ProviderError } from "./types.js";

/**
 * Nasdaq's quote summary, used for one thing: market cap, which Yahoo's keyless chart does not
 * carry. US equities only, unofficial and keyless. Without a Finnhub key this is the only source
 * of market cap, and when it fails the window simply leaves the row out.
 */

const SUMMARY_URL = "https://api.nasdaq.com/api/quote/";

/** Market cap in currency units, or undefined when the summary has none. */
export function parseMarketCap(body: unknown): number | undefined {
  const root = body as { data?: { summaryData?: { MarketCap?: { value?: unknown } } } | null; status?: { rCode?: number } };
  if (!root?.data) {
    throw new ProviderError(root?.status?.rCode === 400 ? "not-found" : "unavailable", "nasdaq summary has no data");
  }
  const raw = root.data.summaryData?.MarketCap?.value;
  if (typeof raw !== "string") return undefined;
  const n = Number(raw.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export async function fetchMarketCap(symbol: string, fetchImpl?: Fetch): Promise<number | undefined> {
  const url = `${SUMMARY_URL}${encodeURIComponent(symbol)}/summary?assetclass=stocks`;
  return parseMarketCap(await getJson(url, { fetchImpl }));
}
