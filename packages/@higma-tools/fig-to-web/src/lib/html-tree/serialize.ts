/**
 * @file Serialize an `HtmlNode` document tree to text.
 *
 * Single point of contact between Figma-author content and HTML/SVG
 * output. The escape rules applied here:
 *
 *   - Text nodes: `&`, `<`, `>` replaced (the canonical text-mode
 *     escape — `&amp;` first so the later replacements don't double
 *     escape).
 *   - Attribute values: `&`, `<`, `>`, `"` replaced. Single quotes
 *     are *not* escaped because the serializer always wraps
 *     attribute values in double quotes.
 *   - Comments: `--` collapsed to `- -` so the comment can never
 *     terminate early.
 *   - `raw` nodes pass through unchanged. They're the explicit
 *     trust-transfer for fragments owned by another subsystem.
 */
import type { HtmlAttr, HtmlNode } from "./types";

export type SerializeOptions = {
  /** Indentation unit per level. Defaults to two spaces. */
  readonly indent?: string;
  /** Initial depth (number of `indent` prefixes). */
  readonly depth?: number;
};

/** Serialize an HTML node sequence to text. Single boundary for HTML escaping. */
export function serialize(nodes: readonly HtmlNode[], options: SerializeOptions = {}): string {
  const indent = options.indent ?? "  ";
  const depth = options.depth ?? 0;
  return nodes.map((node) => serializeNode(node, indent, depth)).join("\n");
}

function serializeNode(node: HtmlNode, indent: string, depth: number): string {
  const lead = indent.repeat(depth);
  switch (node.kind) {
    case "doctype":
      return `${lead}<!DOCTYPE ${node.value}>`;
    case "text":
      return `${lead}${escapeText(node.value)}`;
    case "raw":
      return `${lead}${node.value}`;
    case "comment":
      return `${lead}<!-- ${node.value.replace(/--/g, "- -")} -->`;
    case "element":
      return serializeElement(node.tag, node.attrs, node.children, node.voidElement, indent, depth);
  }
}

function serializeElement(
  tag: string,
  attrs: readonly HtmlAttr[],
  children: readonly HtmlNode[],
  voidElement: boolean,
  indent: string,
  depth: number,
): string {
  const lead = indent.repeat(depth);
  const attrStr = serializeAttrs(attrs);
  const open = attrStr.length === 0 ? `<${tag}` : `<${tag}${attrStr}`;
  if (voidElement) {
    return `${lead}${open} />`;
  }
  if (children.length === 0) {
    return `${lead}${open}></${tag}>`;
  }
  const inline = children.length === 1 && (children[0]?.kind === "text" || children[0]?.kind === "raw");
  if (inline) {
    const only = children[0] as HtmlNode;
    return `${lead}${open}>${renderInlineChild(only)}</${tag}>`;
  }
  const inner = children.map((child) => serializeNode(child, indent, depth + 1)).join("\n");
  return `${lead}${open}>\n${inner}\n${lead}</${tag}>`;
}

/**
 * Inline-render a single text/raw child without surrounding
 * indentation. `text` flows through HTML escaping; `raw` is the
 * trust transfer for already-validated markup.
 */
function renderInlineChild(node: HtmlNode): string {
  if (node.kind === "text") {
    return escapeText(node.value);
  }
  if (node.kind === "raw") {
    return node.value;
  }
  throw new Error(`html-tree: renderInlineChild called with non-text node kind="${node.kind}"`);
}

function serializeAttrs(attrs: readonly HtmlAttr[]): string {
  if (attrs.length === 0) {
    return "";
  }
  return attrs.map((attr) => ` ${attr.name}="${escapeAttr(attr.value)}"`).join("");
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
