import { POINTS } from "./format.js";
import * as finnhub from "./providers/finnhub.js";
import * as nasdaq from "./providers/nasdaq.js";
import * as yahoo from "./providers/yahoo.js";
import { ProviderError, type ChartRange, type Details, type Earnings, type Quote, type SearchResult, type Series } from "./providers/types.js";

/**
 * Decides which source answers, and makes sure several keys on one symbol cost one request.
 *
 * - No Finnhub key: everything from Yahoo's chart.
 * - A key: the price from Finnhub, falling back to Yahoo for anything Finnhub cannot price. Yahoo
 *   is still asked for the sparkline, which Finnhub's free tier does not offer.
 * - Market cap: Finnhub's profile with a key, otherwise Nasdaq for plain US tickers, otherwise
 *   left out.
 *
 * Nothing here knows about Stream Deck, so it is tested with stub providers.
 */

export type Snapshot = {
  quote: Quote;
  details: Details;
  series?: Series;
  fetchedAt: number;
  /** A key is set but Finnhub refused it, so these numbers came from Yahoo. */
  keyRejected?: boolean;
};

export type Providers = {
  yahooChart: (symbol: string) => Promise<yahoo.ChartResult>;
  yahooSearch: (query: string) => Promise<SearchResult[]>;
  yahooRange: (symbol: string, range: ChartRange) => Promise<yahoo.ChartResult>;
  finnhubQuote: (symbol: string, key: string) => Promise<Quote>;
  finnhubProfile: (symbol: string, key: string) => Promise<finnhub.Profile>;
  finnhubMetric: (symbol: string, key: string) => Promise<finnhub.Metric>;
  finnhubEarnings: (symbol: string, key: string, today: string) => Promise<Earnings | undefined>;
  finnhubSearch: (query: string, key: string) => Promise<SearchResult[]>;
  nasdaqMarketCap: (symbol: string) => Promise<number | undefined>;
};

export const liveProviders: Providers = {
  yahooChart: (s) => yahoo.fetchChart(s),
  yahooSearch: (q) => yahoo.search(q),
  yahooRange: (s, r) => yahoo.fetchRange(s, r),
  finnhubQuote: (s, k) => finnhub.fetchQuote(s, k),
  finnhubProfile: (s, k) => finnhub.fetchProfile(s, k),
  finnhubMetric: (s, k) => finnhub.fetchMetric(s, k),
  finnhubEarnings: (s, k, t) => finnhub.fetchEarnings(s, k, t),
  finnhubSearch: (q, k) => finnhub.search(q, k),
  nasdaqMarketCap: (s) => nasdaq.fetchMarketCap(s),
};

/** A quote this fresh is served from the cache, so keys that tick together share one request. */
const QUOTE_TTL_MS = 20_000;
/** Market cap, ratios and the earnings date barely move within a session. */
const FUNDAMENTALS_TTL_MS = 60 * 60_000;
/** A 5-day or longer chart changes slowly enough to keep while the window is open. */
const RANGE_TTL_MS = 10 * 60_000;
/** A company's profile — name, industry, logo — changes on the scale of years; a day is plenty. */
const PROFILE_TTL_MS = 24 * 60 * 60_000;
/** The earnings date for the key's badge; asked for once every few hours per symbol. */
const EARNINGS_TTL_MS = 6 * 60 * 60_000;

/**
 * A plain US ticker — no exchange suffix, index caret, pair or future. The only symbols Nasdaq
 * knows, and the only ones Finnhub's free plan prices.
 */
const US_TICKER = /^[A-Z]{1,5}$/;

type Cached<T> = { at: number; value: T };

export class QuoteService {
  private readonly providers: Providers;
  private readonly now: () => number;
  private readonly quotes = new Map<string, Cached<Snapshot>>();
  private readonly inflight = new Map<string, Promise<Snapshot>>();
  private readonly fundamentals = new Map<string, Cached<Details>>();
  private readonly earningsCache = new Map<string, Cached<Earnings | undefined>>();
  private readonly ranges = new Map<string, Cached<Series>>();
  private readonly profiles = new Map<string, Cached<finnhub.Profile | undefined>>();
  private readonly profilesInflight = new Map<string, Promise<finnhub.Profile | undefined>>();

  constructor(
    private readonly getKey: () => string | null | Promise<string | null>,
    options: { providers?: Providers; now?: () => number } = {}
  ) {
    this.providers = options.providers ?? liveProviders;
    this.now = options.now ?? Date.now;
  }

  /** Drops every cached answer — after the key changes, so the next tick uses the new source. */
  invalidate(): void {
    this.quotes.clear();
    this.fundamentals.clear();
    this.earningsCache.clear();
    this.profiles.clear();
  }

  /**
   * The company's logo URL, for a board's rows: one Finnhub profile request per symbol, kept a day
   * and shared with the detail view. Needs a key; only plain US tickers have one on the free plan.
   * Never throws — a missing logo is an initial on a tile, not an error.
   */
  async logo(symbol: string): Promise<string | undefined> {
    return (await this.profile(normalise(symbol)))?.logo;
  }

  private async profile(id: string): Promise<finnhub.Profile | undefined> {
    if (!US_TICKER.test(id)) return undefined;
    const cached = this.profiles.get(id);
    if (cached && this.now() - cached.at < PROFILE_TTL_MS) return cached.value;
    const pending = this.profilesInflight.get(id);
    if (pending) return pending;
    const request = (async () => {
      const key = await this.getKey();
      if (!key) return undefined;
      try {
        const value = await this.providers.finnhubProfile(id, key);
        this.profiles.set(id, { at: this.now(), value });
        return value;
      } catch {
        // Not cached: a rate limit or a blip should not hide the logo for a day.
        return undefined;
      }
    })().finally(() => this.profilesInflight.delete(id));
    this.profilesInflight.set(id, request);
    return request;
  }

  /**
   * The next earnings report, for the key's badge. Needs a Finnhub key; without one, or for a
   * symbol Finnhub has no calendar for, it is undefined. Never throws: a badge is not worth an
   * alert.
   */
  async earnings(symbol: string): Promise<Earnings | undefined> {
    const id = normalise(symbol);
    const cached = this.earningsCache.get(id);
    if (cached && this.now() - cached.at < EARNINGS_TTL_MS) return cached.value;
    if (!US_TICKER.test(id)) return undefined;
    const key = await this.getKey();
    if (!key) return undefined;
    const value = await this.providers.finnhubEarnings(id, key, exchangeDate(this.now())).catch(() => undefined);
    this.earningsCache.set(id, { at: this.now(), value });
    return value;
  }

  /**
   * The current quote for `symbol`. `force` skips the cache (a press means "now"), but still joins
   * a request already on its way rather than starting a second.
   */
  async snapshot(symbol: string, options: { force?: boolean } = {}): Promise<Snapshot> {
    const id = normalise(symbol);
    const cached = this.quotes.get(id);
    if (!options.force && cached && this.now() - cached.at < QUOTE_TTL_MS) return cached.value;
    const pending = this.inflight.get(id);
    if (pending) return pending;
    const request = this.fetchSnapshot(id).finally(() => this.inflight.delete(id));
    this.inflight.set(id, request);
    const value = await request;
    this.quotes.set(id, { at: this.now(), value });
    return value;
  }

  /** The snapshot plus market cap and the 52-week range, for the detail window. */
  async detailed(symbol: string): Promise<Snapshot> {
    const id = normalise(symbol);
    const snap = await this.snapshot(id);
    const extra = await this.fetchFundamentals(id, snap);
    return { ...snap, details: { ...snap.details, ...definedOnly(extra) } };
  }

  /**
   * The window's chart for a range. Today's comes from the quote already fetched; longer ranges are
   * one Yahoo request each, asked for only when picked. Always Yahoo: Finnhub's free plan has no
   * price history.
   */
  async chart(symbol: string, range: ChartRange, options: { force?: boolean } = {}): Promise<Series> {
    const id = normalise(symbol);
    if (range === "1d") {
      const snap = await this.snapshot(id, options);
      if (snap.series && snap.series.points.length > 1) return snap.series;
    }
    const key = `${id}:${range}`;
    const cached = this.ranges.get(key);
    if (!options.force && cached && this.now() - cached.at < (range === "1d" ? QUOTE_TTL_MS : RANGE_TTL_MS)) return cached.value;
    const { series } = await this.providers.yahooRange(id, range);
    this.ranges.set(key, { at: this.now(), value: series });
    return series;
  }

  /** Yahoo's search, falling back to Finnhub's when Yahoo is down and a key is set. */
  async search(query: string): Promise<SearchResult[]> {
    const q = query.trim();
    if (!q) return [];
    try {
      return await this.providers.yahooSearch(q);
    } catch (error) {
      const key = await this.getKey();
      if (!key) throw error;
      return this.providers.finnhubSearch(q, key);
    }
  }

  private async fetchSnapshot(symbol: string): Promise<Snapshot> {
    // Finnhub's free plan prices plain US tickers only, so it is not asked about an index, a
    // Toronto or London listing, or a coin — Yahoo answers those either way.
    const key = US_TICKER.test(symbol) ? await this.getKey() : null;
    const [chart, fh] = await Promise.allSettled([
      this.providers.yahooChart(symbol),
      key ? this.providers.finnhubQuote(symbol, key) : Promise.reject(new ProviderError("unauthorized", "no key")),
    ]);
    const fetchedAt = this.now();
    const keyRejected = !!key && fh.status === "rejected" && kindOf(fh.reason) === "unauthorized";

    if (fh.status === "fulfilled") {
      const y = chart.status === "fulfilled" ? chart.value : undefined;
      return {
        // Finnhub's quote has no name or currency; borrow Yahoo's when it answered.
        quote: { ...fh.value, name: y?.quote.name, currency: y?.quote.currency },
        details: y?.details ?? {},
        series: y?.series,
        fetchedAt,
      };
    }
    if (chart.status === "fulfilled") {
      return { ...chart.value, fetchedAt, keyRejected: keyRejected || undefined };
    }
    // Both failed. "Not found" from either is the most useful thing to say; otherwise Yahoo's
    // reason, since it is the source that was meant to work without a key.
    const reasons = [chart.reason, key ? fh.reason : undefined];
    const notFound = reasons.find((r) => kindOf(r) === "not-found");
    throw notFound ?? chart.reason;
  }

  private async fetchFundamentals(symbol: string, snap: Snapshot): Promise<Details> {
    const cached = this.fundamentals.get(symbol);
    if (cached && this.now() - cached.at < FUNDAMENTALS_TTL_MS) return cached.value;

    const key = await this.getKey();
    let value: Details = {};
    if (key && snap.quote.source === "finnhub") {
      const [profile, metric, earnings] = await Promise.allSettled([
        this.profile(symbol),
        this.providers.finnhubMetric(symbol, key),
        this.earnings(symbol),
      ]);
      if (profile.status === "fulfilled" && profile.value) {
        const { name: _name, exchange: _exchange, ...rest } = profile.value;
        value = { ...value, ...definedOnly(rest) };
      }
      if (metric.status === "fulfilled") value = { ...value, ...definedOnly(metric.value) };
      if (earnings.status === "fulfilled" && earnings.value) value.earnings = earnings.value;
    }
    if (value.marketCap === undefined && isUsEquity(symbol, snap)) {
      value.marketCap = await this.providers.nasdaqMarketCap(symbol).catch(() => undefined);
    }
    this.fundamentals.set(symbol, { at: this.now(), value });
    return value;
  }
}

/**
 * Today's date on Wall Street, YYYY-MM-DD — the calendar Finnhub's earnings dates are written in.
 * A date, not a time of day, so Node's bundled zone data is close enough here.
 */
export function exchangeDate(now: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Whole days from `today` to `date`, both YYYY-MM-DD. */
export function daysUntil(date: string, today: string): number {
  return Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
}

/**
 * What a move in this symbol is counted in: points for an index, else its currency. Yahoo labels
 * an index with its market's currency, but an index level is not a price.
 */
export function unitOf(snap: Pick<Snapshot, "quote" | "details">): string | undefined {
  const index = snap.details.instrumentType === "INDEX" || snap.quote.symbol.startsWith("^");
  return index ? POINTS : snap.quote.currency;
}

export function normalise(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function isUsEquity(symbol: string, snap: Snapshot): boolean {
  const type = snap.details.instrumentType;
  return US_TICKER.test(symbol) && (type === undefined || type === "EQUITY") && (snap.quote.currency ?? "USD") === "USD";
}

function kindOf(error: unknown): string | undefined {
  return error instanceof ProviderError ? error.kind : undefined;
}

function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
