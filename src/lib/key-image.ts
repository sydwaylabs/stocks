import { formatChangeShort, formatPct, formatPrice, trendOf, type Trend } from "./format.js";

/**
 * Draws the ticker key as a 144×144 SVG (the @2x size).
 *
 * Written for the Stream Deck's own renderer, which does less than WebKit
 * (references/key-images.md): it ignores font-family and drops rgba(), so every colour is solid
 * hex — dimmed colours are mixed against the background here — and every string is sized for its
 * length rather than trusting a face's metrics.
 */

/** A watchlist's place in its list, drawn as a row of dots across the top. */
export type Dots = { count: number; active: number };

export type KeyView =
  | { kind: "empty"; caption?: string }
  | { kind: "loading"; symbol: string; dots?: Dots }
  | {
      kind: "alert";
      symbol: string;
      price?: number;
      /** "Above 350.00", "Down 3% today", or a setup prompt. */
      caption: string;
      /** "1.9% away", "Rearms below 348.25". */
      detail?: string;
      state: "armed" | "fired" | "cleared" | "setup";
      /** Which half of the fired pulse to draw. */
      pulse?: boolean;
      stale?: boolean;
    }
  | {
      kind: "quote";
      dots?: Dots;
      symbol: string;
      price: number;
      change?: number;
      changePct?: number;
      points?: number[];
      prevClose?: number;
      currency?: string;
      display: "price" | "change";
      /** Today's move as a percentage or as an amount in the quote's currency. */
      changeAs: "percent" | "amount";
      /** An earnings report is due within the next week (needs a Finnhub key). */
      earningsSoon?: boolean;
      stale: boolean;
    }
  | { kind: "error"; symbol: string; message: string; hint?: string; dots?: Dots };

const SIZE = 144;
const BG = "#000000";
const FG = "#f4f4f6";
const DIM = "#8b8b93";
const ACCENT = "#29bd50";
const COLOURS: Record<Trend, string> = { up: "#29bd50", down: "#ef4b4b", flat: "#8b8b93" };

/** `amount` of the way from `a` to `b`, both #rrggbb — a solid stand-in for b at that opacity over a. */
export function mixHex(a: string, b: string, amount: number): string {
  const from = Number.parseInt(a.slice(1), 16);
  const to = Number.parseInt(b.slice(1), 16);
  const out = [16, 8, 0].map((shift) => {
    const x = (from >> shift) & 255;
    const y = (to >> shift) & 255;
    return Math.round(x + (y - x) * amount);
  });
  return `#${out.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Symbols are letters, so wider per character than digits; sized by length, then truncated. */
export function symbolFont(symbol: string): { text: string; size: number } {
  if (symbol.length <= 5) return { text: symbol, size: 28 };
  if (symbol.length <= 7) return { text: symbol, size: 22 };
  return { text: symbol.length <= 9 ? symbol : `${symbol.slice(0, 8)}…`, size: 18 };
}

/** Digits run about 0.56 of the font size; each length regime fits inside 132px of key. */
export function numberFont(text: string): number {
  if (text.length <= 5) return 40;
  if (text.length <= 6) return 36;
  if (text.length <= 7) return 31;
  return 27;
}

function text(x: number, y: number, size: number, fill: string, body: string, weight = 700): string {
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="middle" font-family="-apple-system, Helvetica, sans-serif">${escapeXml(body)}</text>`;
}

/** A polyline through the day's closes, fitted to the band, with the previous close as a rule. */
export function sparkline(points: number[], prevClose: number | undefined, colour: string, box: { x: number; y: number; w: number; h: number }): string {
  if (points.length < 2) return "";
  const values = prevClose !== undefined ? [...points, prevClose] : points;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const yOf = (v: number) => box.y + box.h - ((v - lo) / span) * box.h;
  const step = box.w / (points.length - 1);
  const coords = points.map((v, i) => `${(box.x + i * step).toFixed(1)},${yOf(v).toFixed(1)}`).join(" ");
  const rule = prevClose !== undefined
    ? `<line x1="${box.x}" y1="${yOf(prevClose).toFixed(1)}" x2="${box.x + box.w}" y2="${yOf(prevClose).toFixed(1)}" stroke="#2e2e33" stroke-width="2"/>`
    : "";
  return `${rule}<polyline points="${coords}" fill="none" stroke="${colour}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`;
}

const EARNINGS = "#fab219";
const AMBER = "#fab219";
/** The fired pulse's dark half: amber mixed well down into the key's black. */
const AMBER_DARK = "#4a3507";

/** Up to twelve dots, centred across the top edge; the current one filled, the rest outlined. */
/** The row of dots sits on the bottom edge, as the world clock's do (Timekeeper). */
const DOTS_Y = 135;

function dotsRow(dots: Dots | undefined): string {
  if (!hasDots(dots)) return "";
  const gap = dots.count > 8 ? 9 : 12;
  const start = SIZE / 2 - ((dots.count - 1) * gap) / 2;
  return Array.from({ length: dots.count }, (_, i) =>
    i === dots.active
      ? `<circle cx="${start + i * gap}" cy="${DOTS_Y}" r="3.5" fill="${FG}"/>`
      : `<circle cx="${start + i * gap}" cy="${DOTS_Y}" r="2.5" fill="#55555c"/>`
  ).join("");
}

function hasDots(dots: Dots | undefined): dots is Dots {
  return !!dots && dots.count > 1;
}

/**
 * A line of words on a 144 key: its own size up to `max`, smaller as it gets longer. 0.6 of the
 * font size is a generous average advance for mixed text at weight 600–700, so 130px always fits.
 */
export function fitSize(line: string, max: number): number {
  return Math.max(11, Math.min(max, Math.floor(130 / (Math.max(1, line.length) * 0.6))));
}

/** Alert keys: the price, then what they are waiting for in amber, then how far there is to go. */
function alertKey(view: Extract<KeyView, { kind: "alert" }>): string {
  const mid = SIZE / 2;
  const sym = symbolFont(view.symbol);
  if (view.state === "fired") {
    const bg = view.pulse ? AMBER : AMBER_DARK;
    const ink = view.pulse ? BG : AMBER;
    const price = view.price !== undefined ? formatPrice(view.price) : "";
    return [
      `<rect width="${SIZE}" height="${SIZE}" fill="${bg}"/>`,
      text(mid, 34, sym.size, ink, sym.text),
      price ? text(mid, 74, numberFont(price), ink, price) : "",
      text(mid, 106, fitSize(view.caption, 17), ink, view.caption, 700),
      text(mid, 132, 16, ink, "Press to clear", 600),
    ].join("");
  }
  const fade = (c: string) => (view.stale ? mixHex(BG, c, 0.45) : c);
  const price = view.price !== undefined ? formatPrice(view.price) : "";
  const captionColour = view.state === "armed" ? AMBER : DIM;
  return [
    text(mid, 34, sym.size, fade(FG), sym.text),
    price ? text(mid, 72, numberFont(price), fade(FG), price) : "",
    text(mid, 104, fitSize(view.caption, 17), fade(captionColour), view.caption, 700),
    view.detail ? text(mid, 130, fitSize(view.detail, 16), fade(DIM), view.detail, 600) : "",
  ].join("");
}

/**
 * A small amber "E" in the top-right corner, clear of a five-letter symbol (whose ink ends near
 * x=120 at 28px). Filled, not outlined, so it survives at 72px.
 */
function earningsBadge(colour: string): string {
  return `<circle cx="134" cy="10" r="9" fill="${colour}"/>`
    + `<text x="134" y="14.5" font-size="13" font-weight="800" fill="${BG}" text-anchor="middle" font-family="-apple-system, Helvetica, sans-serif">E</text>`;
}

export function renderKey(view: KeyView): string {
  const parts: string[] = [`<rect width="${SIZE}" height="${SIZE}" fill="${BG}"/>`];
  const mid = SIZE / 2;

  switch (view.kind) {
    case "alert":
      // The fired state paints its own background over the black.
      parts.push(alertKey(view));
      break;

    case "empty":
      parts.push(
        `<circle cx="${mid}" cy="58" r="26" fill="none" stroke="${ACCENT}" stroke-width="5"/>`,
        `<rect x="${mid - 2.5}" y="44" width="5" height="28" rx="2" fill="${ACCENT}"/>`,
        `<rect x="${mid - 14}" y="55.5" width="28" height="5" rx="2" fill="${ACCENT}"/>`,
        text(mid, 116, 19, DIM, "Press to", 600),
        text(mid, 137, 19, DIM, view.caption ?? "choose", 600)
      );
      break;

    case "loading": {
      const sym = symbolFont(view.symbol);
      parts.push(text(mid, 40, sym.size, FG, sym.text), text(mid, 86, 30, DIM, "···"), dotsRow(view.dots));
      break;
    }

    case "error": {
      const sym = symbolFont(view.symbol);
      parts.push(text(mid, 40, sym.size, FG, sym.text), text(mid, 86, 20, "#fab219", view.message, 600));
      if (view.hint) parts.push(text(mid, hasDots(view.dots) ? 112 : 116, 17, DIM, view.hint, 600));
      parts.push(dotsRow(view.dots));
      break;
    }

    case "quote": {
      const trend = trendOf(view.change ?? view.changePct);
      // Stale data is drawn at half strength: still readable, visibly not current.
      const fade = (c: string) => (view.stale ? mixHex(BG, c, 0.45) : c);
      const colour = fade(COLOURS[trend]);
      const sym = symbolFont(view.symbol);
      // With dots on the bottom edge, everything moves up and the sparkline gives a little height.
      const dotted = hasDots(view.dots);
      const L = dotted
        ? { symbol: 31, price: 64, spark: { y: 74, h: 21 }, move: 117, big: 68, bigSpark: { y: 82, h: 28 } }
        : { symbol: 34, price: 72, spark: { y: 84, h: 26 }, move: 136, big: 80, bigSpark: { y: 96, h: 32 } };
      // A Watchlist key holds a row of dots as well, so its text steps down about a seventh to keep
      // the same breathing room as a Ticker key; same size, it read as larger beside one.
      const scale = dotted ? 0.86 : 1;
      parts.push(text(mid, L.symbol, Math.round(sym.size * scale), fade(FG), sym.text));
      if (view.earningsSoon) parts.push(earningsBadge(fade(EARNINGS)));

      const move = view.changeAs === "amount" ? formatChangeShort(view.change, view.currency) : formatPct(view.changePct);
      if (view.display === "change" && move) {
        parts.push(text(mid, L.big, Math.round(numberFont(move) * scale), colour, move));
        parts.push(sparkline(view.points ?? [], view.prevClose, mixHex(BG, colour, 0.6), { x: 14, ...L.bigSpark, w: 116 }));
      } else {
        const price = formatPrice(view.price);
        parts.push(text(mid, L.price, Math.round(numberFont(price) * (dotted ? 0.9 : 1)), fade(FG), price));
        parts.push(sparkline(view.points ?? [], view.prevClose, mixHex(BG, colour, 0.5), { x: 14, ...L.spark, w: 116 }));
        if (move) parts.push(text(mid, L.move, move.length > 8 ? 18 : dotted ? 19 : 22, colour, move));
      }
      parts.push(dotsRow(view.dots));
      break;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">${parts.join("")}</svg>`;
}

export function toDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}
