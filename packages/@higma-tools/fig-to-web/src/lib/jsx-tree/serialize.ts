/**
 * @file Serialize a `JsxNode` tree to TSX source.
 *
 * The serializer is the single point where strings cross into JSX
 * source, so every escape happens here:
 *
 *   - Text children render as `{<json-string>}` JSX expressions, never
 *     as raw text. JSON.stringify produces a JS string literal that
 *     is safe to drop into a JS expression context, sidestepping the
 *     `<` / `&` / `}` problems raw JSX text has.
 *   - String props render as `name={<json-string>}` for the same
 *     reason — `name="..."` would require HTML-attribute escaping
 *     we'd have to maintain by hand.
 *   - Expression props pass through verbatim. The caller is
 *     responsible for them; this is the only authority transfer in
 *     the serializer.
 *   - Style props render with JS-identifier keys unquoted and any
 *     other key (CSS custom properties etc.) JSON-quoted; values are
 *     always JSON-quoted.
 *
 * Indentation: every element opens at the current depth; block
 * children get `(depth + 1) * indentUnit` spaces; inline elements emit
 * the entire `<tag…>…</tag>` on one line so `<span>`s wrapping run
 * spans don't pick up rendered whitespace.
 */
import type { JsxLayout, JsxNode, JsxProp, JsxStyleEntry } from "./types";

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export type SerializeOptions = {
  /** Indentation unit per level. Defaults to two spaces. */
  readonly indent?: string;
  /** Initial depth (number of `indent` prefixes) before the root tag. */
  readonly depth?: number;
};

/** Serialize a JSX tree to TSX source. Single boundary for value escaping. */
export function serialize(node: JsxNode, options: SerializeOptions = {}): string {
  const indent = options.indent ?? "  ";
  const depth = options.depth ?? 0;
  return serializeNode(node, indent, depth);
}

function serializeNode(node: JsxNode, indent: string, depth: number): string {
  switch (node.kind) {
    case "text":
      return `${indent.repeat(depth)}{${JSON.stringify(node.value)}}`;
    case "expr":
      return `${indent.repeat(depth)}{${node.code}}`;
    case "fragment":
      return serializeFragment(node.children, indent, depth);
    case "element":
      return serializeElement(node.tag, node.props, node.children, node.layout, indent, depth);
  }
}

function serializeFragment(children: readonly JsxNode[], indent: string, depth: number): string {
  if (children.length === 0) {
    return `${indent.repeat(depth)}<></>`;
  }
  const inner = children.map((child) => serializeNode(child, indent, depth + 1)).join("\n");
  return `${indent.repeat(depth)}<>\n${inner}\n${indent.repeat(depth)}</>`;
}

function resolveLayout(layout: JsxLayout, children: readonly JsxNode[]): "self-close" | "block" | "inline" {
  if (children.length === 0) {
    return "self-close";
  }
  if (layout === "block") {
    return "block";
  }
  if (layout === "inline") {
    return "inline";
  }
  if (children.length === 1) {
    const only = children[0];
    if (only && (only.kind === "text" || only.kind === "expr")) {
      return "inline";
    }
  }
  if (children.every((child) => child.kind === "text" || child.kind === "expr")) {
    return "inline";
  }
  return "block";
}

function serializeElement(
  tag: string,
  props: readonly JsxProp[],
  children: readonly JsxNode[],
  layout: JsxLayout,
  indent: string,
  depth: number,
): string {
  const attrs = serializeProps(props);
  const open = attrs.length === 0 ? `<${tag}` : `<${tag}${attrs}`;
  const decision = resolveLayout(layout, children);
  const lead = indent.repeat(depth);
  if (decision === "self-close") {
    return `${lead}${open} />`;
  }
  if (decision === "inline") {
    const inner = children.map(serializeChildInline).join("");
    return `${lead}${open}>${inner}</${tag}>`;
  }
  const inner = children.map((child) => serializeNode(child, indent, depth + 1)).join("\n");
  return `${lead}${open}>\n${inner}\n${lead}</${tag}>`;
}

function serializeChildInline(child: JsxNode): string {
  switch (child.kind) {
    case "text":
      return `{${JSON.stringify(child.value)}}`;
    case "expr":
      return `{${child.code}}`;
    case "fragment":
      return child.children.map(serializeChildInline).join("");
    case "element": {
      const attrs = serializeProps(child.props);
      const open = attrs.length === 0 ? `<${child.tag}` : `<${child.tag}${attrs}`;
      const decision = resolveLayout(child.layout, child.children);
      if (decision === "self-close") {
        return `${open} />`;
      }
      const inner = child.children.map(serializeChildInline).join("");
      return `${open}>${inner}</${child.tag}>`;
    }
  }
}

function serializeProps(props: readonly JsxProp[]): string {
  if (props.length === 0) {
    return "";
  }
  return props.map((prop) => ` ${serializeProp(prop)}`).join("");
}

function serializeProp(prop: JsxProp): string {
  switch (prop.kind) {
    case "string":
      return `${prop.name}=${JSON.stringify(prop.value)}`;
    case "expr":
      return `${prop.name}={${prop.code}}`;
    case "flag":
      return prop.name;
    case "spread":
      return `{...${prop.code}}`;
    case "style":
      return `style={{${serializeStyleEntries(prop.entries)}}}`;
  }
}

function serializeStyleEntries(entries: readonly JsxStyleEntry[]): string {
  if (entries.length === 0) {
    return "";
  }
  return entries.map(serializeStyleEntry).join(", ");
}

function serializeStyleEntry(entry: JsxStyleEntry): string {
  return `${formatStyleKey(entry.key)}: ${JSON.stringify(entry.value)}`;
}

function formatStyleKey(key: string): string {
  if (IDENT_RE.test(key)) {
    return key;
  }
  return JSON.stringify(key);
}
