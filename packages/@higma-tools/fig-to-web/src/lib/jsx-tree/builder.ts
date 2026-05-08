/**
 * @file Constructors for the JSX tree model.
 *
 * Wrap untrusted strings into typed `JsxNode` / `JsxProp` values so
 * the only place a raw string crosses into TSX source is the
 * serializer, where escaping is enforced uniformly.
 */
import type { JsxLayout, JsxNode, JsxProp, JsxStyleEntry } from "./types";

/** Build a JSX element node with optional props, children, and layout strategy. */
export function el(
  tag: string,
  options: { readonly props?: readonly JsxProp[]; readonly children?: readonly JsxNode[]; readonly layout?: JsxLayout } = {},
): JsxNode {
  return {
    kind: "element",
    tag,
    props: options.props ?? [],
    children: options.children ?? [],
    layout: options.layout ?? "auto",
  };
}

/** Build a JSX text child. The serializer wraps it in `{"..."}` so any character is safe. */
export function text(value: string): JsxNode {
  return { kind: "text", value };
}

/** Build a JSX expression child. `code` is verbatim TS — caller owns its validity. */
export function expr(code: string): JsxNode {
  return { kind: "expr", code };
}

/** Build a fragment (`<>…</>`) with the given children. */
export function frag(children: readonly JsxNode[]): JsxNode {
  return { kind: "fragment", children };
}

/** Build a `name={"value"}` string prop — the serializer JSON-escapes the value. */
export function strProp(name: string, value: string): JsxProp {
  return { kind: "string", name, value };
}

/** Build a `name={code}` expression prop. `code` is verbatim TS. */
export function exprProp(name: string, code: string): JsxProp {
  return { kind: "expr", name, code };
}

/** Build a boolean prop emitted as a bare attribute name (`aria-hidden`). */
export function flagProp(name: string): JsxProp {
  return { kind: "flag", name };
}

/** Build a `{...code}` spread prop. */
export function spreadProp(code: string): JsxProp {
  return { kind: "spread", code };
}

/**
 * Build a `style={{ ... }}` prop. `entries` may be a flat list of
 * `{key,value}` pairs (preserving insertion order) or a record. The
 * record form mirrors how the existing emit pipeline aggregates
 * style; later entries with the same key win, matching the previous
 * `Object.assign` semantics.
 */
export function styleProp(entries: Record<string, string> | readonly JsxStyleEntry[]): JsxProp {
  if (Array.isArray(entries)) {
    return { kind: "style", entries: entries as readonly JsxStyleEntry[] };
  }
  const record = entries as Record<string, string>;
  const list: JsxStyleEntry[] = [];
  for (const key of Object.keys(record)) {
    list.push({ key, value: record[key] as string });
  }
  return { kind: "style", entries: list };
}
