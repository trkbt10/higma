/**
 * @file Tailwind utility-class emit strategy.
 *
 * `cssMode: "tailwind"` replaces every `style={{ … }}` prop with a
 * `className="…"` literal that Tailwind's JIT compiler can scan
 * statically. No sidecar CSS is emitted: Tailwind generates the
 * stylesheet from the class strings during the consumer's build.
 *
 * Approach: every CSS entry that the emit pipeline produces is
 * translated to one or more Tailwind utilities. Three translation
 * tiers:
 *
 *   1. Categorical properties (`display`, `align-items`, …) map to
 *      their canonical Tailwind utility name (`flex`, `items-center`).
 *   2. Single-value numeric / color properties use the arbitrary
 *      bracket form (`p-[12px]`, `bg-[rgb(0,0,0)]`,
 *      `text-[var(--color-primary)]`). This is JIT-safe because the
 *      value lives in the literal class string.
 *   3. Anything else — multi-value shorthands the splitter can't
 *      reach, vendor prefixes, free-form CSS — falls back to
 *      Tailwind's universal `[property:value]` form (spaces escaped
 *      as underscores).
 *
 * The translator is deliberately conservative: when in doubt, emit
 * the universal arbitrary form. That avoids subtly-wrong utilities
 * (`p-3` when the consumer's spacing scale doesn't define `3` as 12px)
 * at the cost of slightly longer class strings. A future iteration
 * could emit a `tailwind.config.ts` alongside the TSX so the design
 * tokens become the project's spacing/color scale.
 *
 * No collector / registry: Tailwind output is purely string
 * substitution — no rules accumulate, no sidecar file is emitted, no
 * cross-component state. The strategy is therefore stateless.
 */
import type { JsxNode, JsxProp, JsxStyleEntry } from "../../../lib/jsx-tree/types";
import { el, strProp } from "../../../lib/jsx-tree/builder";
import { cssPropertyName } from "./css-modules";

/**
 * Categorical mappings keyed by CSS property → value → Tailwind class.
 *
 * Only properties that Figma's style emitter actually produces are
 * listed; adding more is a single-line addition. When a property
 * appears in this table but the specific value is missing, the
 * translator falls through to the bracket form for that entry.
 */
const CATEGORICAL: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  display: {
    flex: "flex",
    "inline-flex": "inline-flex",
    block: "block",
    "inline-block": "inline-block",
    grid: "grid",
    none: "hidden",
  },
  position: {
    relative: "relative",
    absolute: "absolute",
    fixed: "fixed",
    static: "static",
    sticky: "sticky",
  },
  "flex-direction": {
    row: "flex-row",
    "row-reverse": "flex-row-reverse",
    column: "flex-col",
    "column-reverse": "flex-col-reverse",
  },
  "flex-wrap": {
    wrap: "flex-wrap",
    nowrap: "flex-nowrap",
    "wrap-reverse": "flex-wrap-reverse",
  },
  "align-items": {
    "flex-start": "items-start",
    "flex-end": "items-end",
    center: "items-center",
    stretch: "items-stretch",
    baseline: "items-baseline",
  },
  "justify-content": {
    "flex-start": "justify-start",
    "flex-end": "justify-end",
    center: "justify-center",
    "space-between": "justify-between",
    "space-around": "justify-around",
    "space-evenly": "justify-evenly",
  },
  "align-self": {
    "flex-start": "self-start",
    "flex-end": "self-end",
    center: "self-center",
    stretch: "self-stretch",
    baseline: "self-baseline",
    auto: "self-auto",
  },
  overflow: {
    hidden: "overflow-hidden",
    visible: "overflow-visible",
    auto: "overflow-auto",
    scroll: "overflow-scroll",
  },
  "text-align": {
    left: "text-left",
    center: "text-center",
    right: "text-right",
    justify: "text-justify",
  },
  "text-decoration": {
    underline: "underline",
    "line-through": "line-through",
    none: "no-underline",
  },
  "text-transform": {
    uppercase: "uppercase",
    lowercase: "lowercase",
    capitalize: "capitalize",
    none: "normal-case",
  },
  "white-space": {
    nowrap: "whitespace-nowrap",
    pre: "whitespace-pre",
    "pre-wrap": "whitespace-pre-wrap",
    "pre-line": "whitespace-pre-line",
    normal: "whitespace-normal",
  },
  "box-sizing": {
    "border-box": "box-border",
    "content-box": "box-content",
  },
  "font-style": {
    italic: "italic",
    normal: "not-italic",
  },
};

/**
 * Single-value properties → Tailwind utility prefix used with the
 * arbitrary bracket form. `p-[12px]`, `gap-[8px]`, `top-[0]`, …
 *
 * Multi-value shorthands (padding: 12px 16px) are split before
 * reaching this table via `splitShorthand`; values that survive as
 * single tokens land here. Properties not listed here flow through to
 * the universal `[property:value]` fallback.
 */
const ARBITRARY_PREFIX: Readonly<Record<string, string>> = {
  width: "w",
  height: "h",
  "min-width": "min-w",
  "min-height": "min-h",
  "max-width": "max-w",
  "max-height": "max-h",
  top: "top",
  right: "right",
  bottom: "bottom",
  left: "left",
  "padding-top": "pt",
  "padding-right": "pr",
  "padding-bottom": "pb",
  "padding-left": "pl",
  "margin-top": "mt",
  "margin-right": "mr",
  "margin-bottom": "mb",
  "margin-left": "ml",
  gap: "gap",
  "row-gap": "gap-y",
  "column-gap": "gap-x",
  color: "text",
  background: "bg",
  "background-color": "bg",
  "background-image": "bg",
  "border-radius": "rounded",
  "border-top-left-radius": "rounded-tl",
  "border-top-right-radius": "rounded-tr",
  "border-bottom-left-radius": "rounded-bl",
  "border-bottom-right-radius": "rounded-br",
  "font-size": "text",
  "font-family": "font",
  "font-weight": "font",
  "line-height": "leading",
  "letter-spacing": "tracking",
  opacity: "opacity",
  "flex-grow": "grow",
  "flex-shrink": "shrink",
  "flex-basis": "basis",
  "z-index": "z",
  "box-shadow": "shadow",
};

/**
 * Translate one style record into the ordered list of Tailwind utility
 * class names. Insertion order is preserved so the resulting
 * `className` reads top-to-bottom in source order — easier to scan
 * during code review than an alphabetised list.
 *
 * Duplicates within a record collapse (`Set`-like dedup) so the same
 * utility never appears twice on one element.
 */
export function styleEntriesToTailwind(entries: readonly JsxStyleEntry[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of entries) {
    const cssProp = cssPropertyName(entry.key);
    for (const cls of translateEntry(cssProp, entry.value)) {
      if (!seen.has(cls)) {
        seen.add(cls);
        out.push(cls);
      }
    }
  }
  return out;
}

function translateEntry(cssProp: string, value: string): readonly string[] {
  // Shorthand split first: `padding: 12px 16px` → per-side entries,
  // each of which then runs through the single-value path.
  const split = splitShorthand(cssProp, value);
  if (split !== undefined) {
    const out: string[] = [];
    for (const [subProp, subValue] of split) {
      for (const cls of translateEntry(subProp, subValue)) {
        out.push(cls);
      }
    }
    return out;
  }

  // Categorical: `display: flex` → `flex`.
  const categorical = CATEGORICAL[cssProp]?.[value];
  if (categorical) {
    return [categorical];
  }

  // Per-side / single-value arbitrary form: `gap-[8px]`,
  // `text-[var(--color-primary)]`, `bg-[rgb(0,0,0)]`.
  const prefix = ARBITRARY_PREFIX[cssProp];
  if (prefix !== undefined) {
    return [`${prefix}-[${escapeArbitraryValue(value)}]`];
  }

  // Padding / margin shorthand collapse: when the splitter chose to
  // leave a single-value `padding: 12px` un-split (the all-equal case),
  // route it through the `p-[12px]` prefix here. Same idea for
  // `margin`.
  if (cssProp === "padding") {
    return [`p-[${escapeArbitraryValue(value)}]`];
  }
  if (cssProp === "margin") {
    return [`m-[${escapeArbitraryValue(value)}]`];
  }

  // Universal escape hatch — Tailwind's `[property:value]` form keeps
  // arbitrary CSS reachable without growing the prefix table. The
  // value is escaped per Tailwind's arbitrary-value rules.
  return [`[${cssProp}:${escapeArbitraryValue(value)}]`];
}

/**
 * Split a CSS shorthand into per-axis or per-side entries when the
 * Tailwind utility set has dedicated per-side utilities.
 *
 * - `padding: 12px` → no split (already single-value).
 * - `padding: 12px 16px` → `padding-top: 12px`, `padding-right: 16px`,
 *   `padding-bottom: 12px`, `padding-left: 16px`.
 * - `padding: 12px 16px 8px` → t=12, r=16, b=8, l=16.
 * - `padding: 12px 16px 8px 4px` → t=12, r=16, b=8, l=4.
 *
 * Returns `undefined` when the property doesn't shorthand-decompose
 * or the value is already a single token; the caller then handles
 * the value as-is.
 */
function splitShorthand(cssProp: string, value: string): readonly (readonly [string, string])[] | undefined {
  if (cssProp !== "padding" && cssProp !== "margin" && cssProp !== "border-radius") {
    return undefined;
  }
  const parts = splitTopLevelTokens(value);
  if (parts.length < 2) {
    return undefined;
  }
  const [t, r, b, l] = expandFourSides(parts);
  if (cssProp === "padding") {
    return [
      ["padding-top", t],
      ["padding-right", r],
      ["padding-bottom", b],
      ["padding-left", l],
    ];
  }
  if (cssProp === "margin") {
    return [
      ["margin-top", t],
      ["margin-right", r],
      ["margin-bottom", b],
      ["margin-left", l],
    ];
  }
  // border-radius: CSS order is top-left, top-right, bottom-right, bottom-left.
  return [
    ["border-top-left-radius", t],
    ["border-top-right-radius", r],
    ["border-bottom-right-radius", b],
    ["border-bottom-left-radius", l],
  ];
}

/**
 * Split a string value into top-level whitespace-separated tokens,
 * preserving balanced `()` groups (e.g. `rgb(255, 0, 0)`) and `[]`
 * groups (CSS arbitrary properties). Naive `value.split(/\s+/)` would
 * incorrectly chop `rgba(0, 0, 0, 0.5)` into pieces.
 */
function splitTopLevelTokens(value: string): readonly string[] {
  const out: string[] = [];
  const refDepth: { value: number } = { value: 0 };
  const refStart: { value: number } = { value: 0 };
  for (let i = 0; i < value.length; i = i + 1) {
    const ch = value.charAt(i);
    if (ch === "(" || ch === "[") {
      refDepth.value = refDepth.value + 1;
      continue;
    }
    if (ch === ")" || ch === "]") {
      refDepth.value = refDepth.value - 1;
      continue;
    }
    if (refDepth.value === 0 && /\s/.test(ch)) {
      if (i > refStart.value) {
        out.push(value.slice(refStart.value, i));
      }
      refStart.value = i + 1;
    }
  }
  if (refStart.value < value.length) {
    out.push(value.slice(refStart.value));
  }
  return out;
}

function expandFourSides(parts: readonly string[]): readonly [string, string, string, string] {
  const [a, b, c, d] = parts;
  if (parts.length === 1 && a !== undefined) {
    return [a, a, a, a];
  }
  if (parts.length === 2 && a !== undefined && b !== undefined) {
    return [a, b, a, b];
  }
  if (parts.length === 3 && a !== undefined && b !== undefined && c !== undefined) {
    return [a, b, c, b];
  }
  if (parts.length >= 4 && a !== undefined && b !== undefined && c !== undefined && d !== undefined) {
    return [a, b, c, d];
  }
  throw new Error(`tailwind: cannot expand shorthand parts: ${JSON.stringify(parts)}`);
}

/**
 * Escape a CSS value for Tailwind's arbitrary bracket form.
 *
 * Tailwind's JIT parses `prop-[value]` by reading until the matching
 * `]`. Inside the brackets, spaces are written as underscores so
 * `bg-[rgb(255,_255,_255)]` survives Tailwind's class-name tokenizer
 * (whitespace inside a class name would split the class). Special
 * characters that Tailwind itself escapes (the underscore meta-char
 * needs `\_`) are not produced here; the input we receive from the
 * style emit never contains a literal underscore in CSS values.
 */
function escapeArbitraryValue(value: string): string {
  return value.replace(/\s+/g, "_");
}

/**
 * Walk a JsxNode tree, replacing every `style={{ … }}` prop with a
 * `className="<utilities>"` literal prop. Empty class strings drop the
 * prop entirely. Mirrors the rewriter shape of the other strategies.
 */
export function rewriteForTailwind(node: JsxNode): JsxNode {
  switch (node.kind) {
    case "text":
    case "expr":
      return node;
    case "fragment":
      return { kind: "fragment", children: node.children.map(rewriteForTailwind) };
    case "element": {
      const rewrittenProps = rewriteProps(node.props);
      const rewrittenChildren = node.children.map(rewriteForTailwind);
      return el(node.tag, { props: rewrittenProps, children: rewrittenChildren, layout: node.layout });
    }
  }
}

function rewriteProps(props: readonly JsxProp[]): readonly JsxProp[] {
  const out: JsxProp[] = [];
  for (const prop of props) {
    if (prop.kind !== "style") {
      out.push(prop);
      continue;
    }
    if (prop.entries.length === 0) {
      continue;
    }
    const classes = styleEntriesToTailwind(prop.entries);
    if (classes.length === 0) {
      continue;
    }
    out.push(strProp("className", classes.join(" ")));
  }
  return out;
}
