/**
 * @file In-memory tree model for HTML / SVG document emission.
 *
 * The fig-to-web pipeline emits a handful of static HTML files
 * (`index.html`, `figma/<slug>.html`, the spec-side
 * `isolate.html`) and one SVG embedded into them. Building those by
 * string concatenation made every site responsible for its own
 * attribute / text escaping; this module replaces the concatenation
 * with a typed tree plus a serializer in `serialize.ts` that escapes
 * untrusted content uniformly.
 *
 * The `raw` variant is the single trust transfer: it embeds a
 * pre-validated XML/HTML fragment verbatim (used for the SVG body
 * `@higma-document-renderers/fig` already produced — that subsystem
 * owns its own escaping). All other paths flow through the
 * serializer.
 */

export type HtmlNode =
  | { readonly kind: "doctype"; readonly value: string }
  | { readonly kind: "element"; readonly tag: string; readonly attrs: readonly HtmlAttr[]; readonly children: readonly HtmlNode[]; readonly voidElement: boolean }
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "raw"; readonly value: string }
  | { readonly kind: "comment"; readonly value: string };

/**
 * One HTML attribute. The value is always a string the serializer
 * will HTML-attribute-escape; null / undefined attributes are
 * omitted by the builder (see `attr` in `builder.ts`).
 */
export type HtmlAttr = { readonly name: string; readonly value: string };
