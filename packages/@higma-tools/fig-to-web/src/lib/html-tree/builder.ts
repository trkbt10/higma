/**
 * @file Constructors for the HTML tree model.
 *
 * Builders take typed values (string, attr record) and produce
 * `HtmlNode`s that the serializer escapes when emitting source. No
 * builder ever accepts a pre-formatted markup string except `raw`,
 * which is the explicit trust-transfer for content (e.g. an SVG body
 * produced by another package) that has already been escaped by its
 * owner.
 */
import type { HtmlAttr, HtmlNode } from "./types";

/**
 * Conventional set of HTML void elements (no closing tag, no
 * children). Membership decides whether the serializer emits
 * `<tag />` or `<tag>...</tag>`.
 */
const VOID_TAGS: ReadonlySet<string> = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/**
 * Build an HTML element node. Attributes whose value is undefined
 * are dropped so callers can pass conditional values without
 * branching.
 */
export function el(
  tag: string,
  attrs: Record<string, string | undefined> = {},
  children: readonly HtmlNode[] = [],
): HtmlNode {
  const list: HtmlAttr[] = [];
  for (const name of Object.keys(attrs)) {
    const value = attrs[name];
    if (value === undefined) {
      continue;
    }
    list.push({ name, value });
  }
  const voidElement = VOID_TAGS.has(tag.toLowerCase());
  return { kind: "element", tag, attrs: list, children, voidElement };
}

/** Build a text node. The serializer HTML-escapes `value` on emit. */
export function text(value: string): HtmlNode {
  return { kind: "text", value };
}

/**
 * Embed a pre-validated markup fragment verbatim. Use this only when
 * the producer of `value` owns its escaping (e.g. the SVG renderer
 * package). Never pass user-supplied strings here.
 */
export function raw(value: string): HtmlNode {
  return { kind: "raw", value };
}

/** Build an HTML comment node. The serializer collapses `--` to prevent early termination. */
export function comment(value: string): HtmlNode {
  return { kind: "comment", value };
}

/** Build a doctype declaration. Defaults to HTML5. */
export function doctype(value: string = "html"): HtmlNode {
  return { kind: "doctype", value };
}
