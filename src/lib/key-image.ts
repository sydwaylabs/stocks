import { formatChangeShort, formatPct, formatPrice, trendOf, type Trend } from "./format.js";

/**
 * Draws the ticker key as a 144×144 SVG (the @2x size).
 *
 * Written for the Stream Deck's own renderer, which does less than WebKit
 * (references/key-images.md): it ignores font-family and drops rgba(), so every colour is solid
 * hex — dimmed colours are mixed against the background here — and every string is sized for its
 * length rather than trusting a face's metrics.
 */

export type KeyView =
  | { kind: "empty" }
  | { kind: "loading"; symbol: string }
  | {
      kind: "quote";
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
      stale: boolean;
    }
  | { kind: "error"; symbol: string; message: string; hint?: string };

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

export function renderKey(view: KeyView): string {
  const parts: string[] = [`<rect width="${SIZE}" height="${SIZE}" fill="${BG}"/>`];
  const mid = SIZE / 2;

  switch (view.kind) {
    case "empty":
      parts.push(
        `<circle cx="${mid}" cy="58" r="26" fill="none" stroke="${ACCENT}" stroke-width="5"/>`,
        `<rect x="${mid - 2.5}" y="44" width="5" height="28" rx="2" fill="${ACCENT}"/>`,
        `<rect x="${mid - 14}" y="55.5" width="28" height="5" rx="2" fill="${ACCENT}"/>`,
        text(mid, 116, 19, DIM, "Press to", 600),
        text(mid, 137, 19, DIM, "choose", 600)
      );
      break;

    case "loading": {
      const sym = symbolFont(view.symbol);
      parts.push(text(mid, 40, sym.size, FG, sym.text), text(mid, 92, 30, DIM, "···"));
      break;
    }

    case "error": {
      const sym = symbolFont(view.symbol);
      parts.push(text(mid, 40, sym.size, FG, sym.text), text(mid, 86, 20, "#fab219", view.message, 600));
      if (view.hint) parts.push(text(mid, 116, 17, DIM, view.hint, 600));
      break;
    }

    case "quote": {
      const trend = trendOf(view.change ?? view.changePct);
      // Stale data is drawn at half strength: still readable, visibly not current.
      const fade = (c: string) => (view.stale ? mixHex(BG, c, 0.45) : c);
      const colour = fade(COLOURS[trend]);
      const sym = symbolFont(view.symbol);
      parts.push(text(mid, 34, sym.size, fade(FG), sym.text));

      const move = view.changeAs === "amount" ? formatChangeShort(view.change, view.currency) : formatPct(view.changePct);
      if (view.display === "change" && move) {
        parts.push(text(mid, 80, numberFont(move), colour, move));
        parts.push(sparkline(view.points ?? [], view.prevClose, mixHex(BG, colour, 0.6), { x: 14, y: 96, w: 116, h: 32 }));
      } else {
        const price = formatPrice(view.price);
        parts.push(text(mid, 72, numberFont(price), fade(FG), price));
        parts.push(sparkline(view.points ?? [], view.prevClose, mixHex(BG, colour, 0.5), { x: 14, y: 84, w: 116, h: 26 }));
        if (move) parts.push(text(mid, 136, move.length > 8 ? 19 : 22, colour, move));
      }
      break;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">${parts.join("")}</svg>`;
}

export function toDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}
