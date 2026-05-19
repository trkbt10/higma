/**
 * @file IR ColorIR ↔ CSS string conversion.
 *
 * Single SoT for both encoding (IR → `rgb(...)` / `rgba(...)`) and the
 * smaller decoding (`rgb(...)` / hex → IR). The web-to-fig direction
 * needs the parser side too; previously the fig-to-web variant was the
 * only direction in code, with copy-pasted projections in svg.ts,
 * paint.ts, effect.ts. Centralising here is a SoT win, not just a
 * convenience.
 */
import type { ColorIR } from "../ir/types";
import { clamp01, round3 } from "./numeric";

/** Convert an IR color to a CSS color string. */
export function colorIRToCss(c: ColorIR): string {
  const r = Math.round(c.r * 255);
  const g = Math.round(c.g * 255);
  const b = Math.round(c.b * 255);
  if (c.a === 1) {
    return `rgb(${r}, ${g}, ${b})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${round3(c.a)})`;
}

/**
 * Parse a CSS color into the IR form. Supports `#rgb`, `#rgba`,
 * `#rrggbb`, `#rrggbbaa`, `rgb(r,g,b)`, `rgba(r,g,b,a)`, and the
 * keywords `transparent` / `black` / `white`. All other named colours
 * throw — the caller (web-to-fig) holds the full computed-style
 * registry and must resolve named colours to a hex form before
 * reaching here, otherwise we'd be silently approximating.
 */
export function cssToColorIR(value: string): ColorIR {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "transparent") {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  if (trimmed === "black") {
    return { r: 0, g: 0, b: 0, a: 1 };
  }
  if (trimmed === "white") {
    return { r: 1, g: 1, b: 1, a: 1 };
  }
  if (trimmed.startsWith("#")) {
    return parseHex(trimmed);
  }
  if (trimmed.startsWith("rgb")) {
    return parseRgbFunctional(trimmed);
  }
  throw new Error(
    `cssToColorIR: cannot parse css color value "${value}". `
    + `Named CSS colours must be resolved by the caller before reaching the bridge.`,
  );
}

function parseHex(input: string): ColorIR {
  const hex = input.slice(1);
  if (hex.length === 3) {
    return {
      r: parseInt(hex[0]! + hex[0]!, 16) / 255,
      g: parseInt(hex[1]! + hex[1]!, 16) / 255,
      b: parseInt(hex[2]! + hex[2]!, 16) / 255,
      a: 1,
    };
  }
  if (hex.length === 4) {
    return {
      r: parseInt(hex[0]! + hex[0]!, 16) / 255,
      g: parseInt(hex[1]! + hex[1]!, 16) / 255,
      b: parseInt(hex[2]! + hex[2]!, 16) / 255,
      a: clamp01(parseInt(hex[3]! + hex[3]!, 16) / 255),
    };
  }
  if (hex.length === 6) {
    return {
      r: parseInt(hex.slice(0, 2), 16) / 255,
      g: parseInt(hex.slice(2, 4), 16) / 255,
      b: parseInt(hex.slice(4, 6), 16) / 255,
      a: 1,
    };
  }
  if (hex.length === 8) {
    return {
      r: parseInt(hex.slice(0, 2), 16) / 255,
      g: parseInt(hex.slice(2, 4), 16) / 255,
      b: parseInt(hex.slice(4, 6), 16) / 255,
      a: clamp01(parseInt(hex.slice(6, 8), 16) / 255),
    };
  }
  throw new Error(`cssToColorIR: invalid hex color "${input}"`);
}

function parseRgbFunctional(input: string): ColorIR {
  const open = input.indexOf("(");
  const close = input.lastIndexOf(")");
  if (open < 0 || close < 0) {
    throw new Error(`cssToColorIR: malformed rgb()/rgba() value "${input}"`);
  }
  const inner = input.slice(open + 1, close);
  const parts = inner.split(/[\s,/]+/).filter((p) => p.length > 0);
  if (parts.length < 3 || parts.length > 4) {
    throw new Error(`cssToColorIR: rgb()/rgba() must have 3 or 4 components, got "${input}"`);
  }
  const r = parseChannel(parts[0]!, "r");
  const g = parseChannel(parts[1]!, "g");
  const b = parseChannel(parts[2]!, "b");
  const a = parts[3] === undefined ? 1 : parseAlpha(parts[3]);
  return { r, g, b, a };
}

function parseChannel(token: string, label: "r" | "g" | "b"): number {
  if (token.endsWith("%")) {
    return clamp01(parseFloat(token.slice(0, -1)) / 100);
  }
  const n = parseFloat(token);
  if (!Number.isFinite(n)) {
    throw new Error(`cssToColorIR: cannot parse ${label} channel "${token}"`);
  }
  return clamp01(n / 255);
}

function parseAlpha(token: string): number {
  if (token.endsWith("%")) {
    return clamp01(parseFloat(token.slice(0, -1)) / 100);
  }
  const n = parseFloat(token);
  if (!Number.isFinite(n)) {
    throw new Error(`cssToColorIR: cannot parse alpha "${token}"`);
  }
  return clamp01(n);
}
