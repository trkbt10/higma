/**
 * @file In-memory tree model for JSX source emission.
 *
 * The fig-to-web emit pipeline writes `.tsx` source files to disk —
 * not runtime HTML. Building those files by string concatenation made
 * every call site responsible for its own escaping; this module
 * replaces that with a structured tree (the `JsxNode` discriminated
 * union) plus a single serializer in `serialize.ts` that emits TSX
 * with all values funnelled through escape-correct routines. Untrusted
 * Figma-author content (TEXT characters, font names, layer names) can
 * never bypass the serializer because every public constructor takes
 * a typed value rather than a pre-formatted string.
 *
 * `JsxLayout` lets the caller pin elements that must NOT have
 * whitespace inserted between children (a `<span>` wrapping run-spans
 * in mid-text would otherwise gain visible space) — `inline` keeps
 * children glued, `block` always indents, `auto` self-closes when
 * empty / inlines a single text-or-expression child / blocks
 * otherwise.
 */

/** Whitespace strategy for an element's children. */
export type JsxLayout = "auto" | "block" | "inline";

/**
 * A renderable JSX node. The `text` variant is intentionally distinct
 * from `expr`: text values are escaped through JSON.stringify into a
 * JSX child expression `{"..."}` so any user-supplied character is
 * safe, while `expr` is a raw TS expression the caller is responsible
 * for ensuring is well-formed (e.g. a prop reference, a function
 * call).
 */
export type JsxNode =
  | { readonly kind: "element"; readonly tag: string; readonly props: readonly JsxProp[]; readonly children: readonly JsxNode[]; readonly layout: JsxLayout }
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "expr"; readonly code: string }
  | { readonly kind: "fragment"; readonly children: readonly JsxNode[] };

/**
 * A single style entry: `{ key: "fontFamily", value: "Inter, system-ui" }`.
 * Both fields are arbitrary strings; the serializer JSON-escapes the
 * value and quotes the key when it isn't a JS identifier (CSS custom
 * properties like `--color-x` need string-keyed entries).
 */
export type JsxStyleEntry = { readonly key: string; readonly value: string };

/**
 * A JSX attribute / prop. Discriminated by `kind` so the serializer
 * can decide on the right syntactic form without re-parsing values:
 *
 *   - `string`: `name={"..."}` — JSON-escaped untrusted string. Safe
 *     for any character set.
 *   - `expr`:   `name={code}` — verbatim TS expression. The caller
 *     guarantees `code` parses as a valid JSX expression.
 *   - `flag`:   `name` — boolean attribute (`aria-hidden`).
 *   - `spread`: `{...code}` — spread of a TS expression onto props.
 *   - `style`:  `style={{ ... }}` — list of CSS entries; the
 *     serializer JSON-quotes values and properly handles
 *     non-identifier keys.
 */
export type JsxProp =
  | { readonly kind: "string"; readonly name: string; readonly value: string }
  | { readonly kind: "expr"; readonly name: string; readonly code: string }
  | { readonly kind: "flag"; readonly name: string }
  | { readonly kind: "spread"; readonly code: string }
  | { readonly kind: "style"; readonly entries: readonly JsxStyleEntry[] };
