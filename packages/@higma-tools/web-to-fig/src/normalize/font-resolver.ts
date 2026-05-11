/**
 * @file Font-family resolution interface.
 *
 * A captured CSS `font-family` is almost never a single name. Browsers
 * are handed an *ordered stack* of candidates and pick the first one
 * the OS happens to have installed:
 *
 *   font-family: -apple-system, system-ui, BlinkMacSystemFont,
 *                "Segoe UI", "Helvetica Neue", sans-serif;
 *
 * On a Mac the browser resolves that to `Helvetica Neue` (or the SF
 * family wired up under `-apple-system`); on Linux it falls through to
 * the platform sans. The `web-to-fig` IR has to carry **one** name —
 * the one the renderer should actually use — otherwise downstream
 * raster output picks a fallback whose glyph metrics drift from the
 * captured screenshot's, producing the "halo of yellow pixels around
 * every glyph" diff visible in `example-com-fullpage`.
 *
 * This module owns:
 *
 *   - the `FontResolver` interface every consumer (normalize.ts,
 *     paragraph.ts) calls instead of grabbing the first comma-split
 *     candidate verbatim,
 *   - `parseFontStack`, the shared `font-family` value tokeniser
 *     (handles quoted names, escaped commas, generic families),
 *   - `UnresolvedFontStackError`, the explicit failure mode when no
 *     resolver is wired up and an ambiguous stack still arrives — we
 *     refuse to silently take the first candidate per AGENTS.md
 *     Fail-Fast policy.
 *
 * The implementation of *which* OS font satisfies the stack lives
 * outside this file (see `src/font-resolver/darwin.ts` and the
 * in-page resolver path) — this file is just the contract.
 */

/** A single token from a `font-family` value. */
export type FontStackCandidate =
  | { readonly kind: "name"; readonly value: string }
  | { readonly kind: "generic"; readonly value: GenericFamily };

/**
 * CSS generic family keywords per the CSS Fonts module (Level 4).
 * Resolvers must answer every variant — dropping `monospace` to
 * "Helvetica" silently rewrites the captured page's `<code>` blocks,
 * and dropping `system-ui` to `sans-serif` is exactly the
 * `-apple-system`-vs-OS-default drift this layer exists to prevent.
 *
 * The list mirrors `GENERIC_FAMILIES` below verbatim — adding one
 * requires updating both, intentionally, so the parser and the
 * resolver contract stay aligned.
 */
export type GenericFamily =
  | "serif"
  | "sans-serif"
  | "monospace"
  | "cursive"
  | "fantasy"
  | "system-ui"
  | "ui-serif"
  | "ui-sans-serif"
  | "ui-monospace"
  | "ui-rounded"
  | "math"
  | "emoji"
  | "fangsong";

const GENERIC_FAMILIES: ReadonlySet<GenericFamily> = new Set<GenericFamily>([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "math",
  "emoji",
  "fangsong",
]);

/**
 * Resolve a parsed font stack into the single family name the IR
 * should carry for downstream rendering. Implementations walk the
 * candidates in order and return the first one whose underlying font
 * is actually available in the target environment.
 *
 * Must NOT silently return a generic keyword (`"sans-serif"`) — the
 * resolver's whole purpose is to land on a concrete installed family.
 * When no candidate matches an installed font, the resolver returns
 * the OS's default for the trailing generic family (e.g. on macOS
 * `sans-serif` → `"Helvetica Neue"`).
 */
export type FontResolver = {
  /**
   * @param stack ordered list of candidates, parsed from CSS via
   *              `parseFontStack`. Includes both quoted/keyword names
   *              and generic keywords in source order.
   * @returns the concrete OS-installed family name the IR should
   *          carry. Throws when no candidate is installed and no
   *          generic fallback was supplied.
   */
  readonly resolve: (stack: readonly FontStackCandidate[]) => string;
};

/**
 * Thrown when a multi-candidate stack reaches normalisation and the
 * caller did not supply a resolver. Callers that genuinely want the
 * first candidate must opt in via a trivial resolver — silent
 * fall-through is what produced the historical drift this module
 * exists to prevent.
 */
export class UnresolvedFontStackError extends Error {
  // Naming this field `candidates` rather than `stack` avoids shadowing
  // `Error.prototype.stack` (the V8 stack trace) — both would be
  // technically allowed but the field name reuse would confuse anyone
  // reading the error in a debugger.
  readonly candidates: readonly FontStackCandidate[];
  constructor(candidates: readonly FontStackCandidate[]) {
    super(
      `font-family stack [${candidates.map(describe).join(", ")}] cannot be resolved without a FontResolver — `
        + `pass one to normalizeViewport({ fontResolver: ... }).`,
    );
    this.name = "UnresolvedFontStackError";
    this.candidates = candidates;
  }
}

/**
 * Tokenise a CSS `font-family` value into ordered candidates.
 *
 *   parseFontStack(`-apple-system, "Helvetica Neue", sans-serif`)
 *     ⇒ [
 *         { kind: "name", value: "-apple-system" },
 *         { kind: "name", value: "Helvetica Neue" },
 *         { kind: "generic", value: "sans-serif" },
 *       ]
 *
 * Quoted names keep their internal commas (`",,,"` is one candidate);
 * generic keywords are recognised case-insensitively. Empty input
 * yields an empty list — callers can then decide whether to default
 * to `sans-serif` themselves (and pay the resolver round-trip) or
 * throw at the call site.
 */
export function parseFontStack(raw: string): readonly FontStackCandidate[] {
  if (raw.trim().length === 0) {
    return [];
  }
  const tokens = splitOutsideQuotes(raw);
  return tokens.map((tok) => {
    const trimmed = tok.trim();
    const stripped = stripQuotes(trimmed);
    if (trimmed === stripped) {
      const lower = stripped.toLowerCase();
      if (isGenericFamily(lower)) {
        return { kind: "generic" as const, value: lower };
      }
    }
    return { kind: "name" as const, value: stripped };
  });
}

function isGenericFamily(value: string): value is GenericFamily {
  return GENERIC_FAMILIES.has(value as GenericFamily);
}

/** Pretty-print a candidate for error messages. */
function describe(candidate: FontStackCandidate): string {
  return candidate.kind === "generic" ? candidate.value : JSON.stringify(candidate.value);
}

/**
 * Split a comma-separated value while treating `"..."` and `'...'`
 * spans as opaque so a quoted family with an embedded comma stays
 * intact. Pure `String.split(",")` would butcher
 * `'"Arial, Bold"'` into two candidates.
 */
function splitOutsideQuotes(raw: string): readonly string[] {
  const out: string[] = [];
  const buf: string[] = [];
  // Single-slot mutable ref instead of `let` per project lint policy.
  const quote: { value: '"' | "'" | undefined } = { value: undefined };
  for (const ch of raw) {
    if (quote.value !== undefined) {
      buf.push(ch);
      if (ch === quote.value) {
        quote.value = undefined;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote.value = ch;
      buf.push(ch);
      continue;
    }
    if (ch === ",") {
      out.push(buf.join(""));
      buf.length = 0;
      continue;
    }
    buf.push(ch);
  }
  if (buf.length > 0 || out.length === 0) {
    out.push(buf.join(""));
  }
  return out;
}

function stripQuotes(value: string): string {
  if (value.length < 2) {
    return value;
  }
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }
  return value;
}
