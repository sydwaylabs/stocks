import { ProviderError } from "./types.js";

/**
 * Sent on every request. Deliberately *not* a full browser string: measured 2026-10-16 from Node,
 * Yahoo answered both a complete Safari and a complete Chrome user agent with 429 on the first
 * request — a browser UA arriving over Node's TLS fingerprint looks like a scraper — while this,
 * a bare "Mozilla/5.0" and no UA at all all got 200 from Yahoo and Nasdaq. Being honest about
 * who is asking is also the better footing with an unofficial endpoint. No URL in it, though:
 * Nasdaq let a UA ending in "+https://…" hang until the timeout, every time.
 */
export const USER_AGENT = "Mozilla/5.0 (compatible; SydwayLabsStocks/1.0)";

const TIMEOUT_MS = 8_000;

export type Fetch = typeof fetch;

/**
 * GETs JSON, mapping transport and HTTP failures onto {@link ProviderError} kinds. A body that is
 * not JSON is `unavailable`: these endpoints answer an outage with an HTML page.
 */
export async function getJson(
  url: string,
  options: { headers?: Record<string, string>; fetchImpl?: Fetch } = {}
): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...options.headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new ProviderError("unavailable", `request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (res.status === 401) throw new ProviderError("unauthorized", "HTTP 401");
  if (res.status === 403) throw new ProviderError("no-access", "HTTP 403");
  if (res.status === 429) throw new ProviderError("rate-limited", "HTTP 429");
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ProviderError(res.status === 404 ? "not-found" : "unavailable", `HTTP ${res.status}, not JSON`);
  }
  // Yahoo reports an unknown symbol as a 404 with a JSON body that says so; let the parser read it.
  if (!res.ok && res.status !== 404) throw new ProviderError("unavailable", `HTTP ${res.status}`);
  return body;
}
