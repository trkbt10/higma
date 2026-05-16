/**
 * @file Serialise a `JsxNode` SVG subtree into standalone XML / SVG
 * text suitable for writing to disk as a `.svg` asset file.
 *
 * The fig-to-web emit pipeline builds vector subtrees as `JsxNode`
 * trees (so they splice cleanly into surrounding JSX through the
 * existing serializer). When a vector subtree's complexity crosses
 * the externalisation threshold the consumer prefers a free-standing
 * `.svg` file under `assets/icons/` referenced via `<img src="…" />`.
 *
 * The JSX serializer emits TSX (`name={"value"}`, `style={{ … }}`),
 * which is wrong for a `.svg` asset — browsers expect plain XML
 * attributes (`name="value"`, `style="…"`). This module produces the
 * XML form.
 *
 * What's handled:
 *   - Element nodes → `<tag attr="...">…</tag>` (or self-closing).
 *   - String props → `name="<xml-escaped value>"`.
 *   - Style props → `style="<kebab-case prop>: <value>; …"`.
 *   - Text children → XML-escaped text content.
 *   - Expression / spread / flag / fragment kinds: the SVG emitter
 *     doesn't produce these inside the vector subtree the caller
 *     hands us, so they raise loudly rather than silently dropping.
 *
 * Top-level `<svg>` automatically gains the `xmlns` namespace so the
 * file parses standalone (the JsxNode form doesn't carry it because
 * JSX implicitly inherits the namespace from the React DOM scope).
 */
import type { JsxNode, JsxProp, JsxStyleEntry } from "../../../lib/jsx-tree/types";
import { cssPropertyName } from "./css-modules";

/**
 * Render a JsxNode subtree as a standalone SVG document.
 *
 * The root element must be `<svg>`; the function adds an XML prolog
 * and ensures `xmlns="http://www.w3.org/2000/svg"` is present so the
 * resulting file is a valid stand-alone asset.
 */
type ElementJsxNode = Extract<JsxNode, { kind: "element" }>;

/**
 * Render a JsxNode subtree as a standalone SVG document.
 *
 * The root element must be `<svg>`; the function adds an XML prolog
 * and ensures `xmlns="http://www.w3.org/2000/svg"` is present so the
 * resulting file is a valid stand-alone asset.
 */
export function serializeSvgDocument(node: JsxNode): string {
  if (node.kind !== "element" || node.tag !== "svg") {
    throw new Error(`svg-serialize: expected an <svg> root, got ${describeNode(node)}`);
  }
  const root = ensureSvgNamespace(node);
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n${serializeElement(root)}\n`;
}

function ensureSvgNamespace(node: ElementJsxNode): ElementJsxNode {
  for (const prop of node.props) {
    if (prop.kind === "string" && prop.name === "xmlns") {
      return node;
    }
  }
  const props: readonly JsxProp[] = [
    { kind: "string", name: "xmlns", value: "http://www.w3.org/2000/svg" },
    ...node.props,
  ];
  return { kind: "element", tag: "svg", props, children: node.children, layout: node.layout };
}

function serializeNode(node: JsxNode): string {
  switch (node.kind) {
    case "element":
      return serializeElement(node);
    case "text":
      return escapeXmlText(node.value);
    case "expr":
      throw new Error(`svg-serialize: expression children are not supported in SVG output (${node.code})`);
    case "fragment":
      // The vector emit pipeline never produces fragments inside an
      // SVG subtree. Silently flattening them would let future emit
      // changes inject content the serializer can't faithfully
      // represent in XML; throw instead per the fail-fast policy.
      throw new Error("svg-serialize: fragment nodes are not allowed inside an SVG subtree");
  }
}

function serializeElement(node: ElementJsxNode): string {
  const attrs = node.props.map(serializeProp).filter((s) => s.length > 0).join(" ");
  const attrStr = attrs.length > 0 ? ` ${attrs}` : "";
  if (node.children.length === 0) {
    return `<${node.tag}${attrStr} />`;
  }
  const inner = node.children.map(serializeNode).join("");
  return `<${node.tag}${attrStr}>${inner}</${node.tag}>`;
}

function serializeProp(prop: JsxProp): string {
  switch (prop.kind) {
    case "string":
      return `${prop.name}="${escapeXmlAttr(prop.value)}"`;
    case "flag":
      // Standalone boolean attributes round-trip to XML as
      // `name="name"` (XHTML-style). The bare-attribute form
      // (`name`) is HTML5-only and not valid XML.
      return `${prop.name}="${prop.name}"`;
    case "style":
      return serializeStyleAttr(prop.entries);
    case "expr":
      throw new Error(`svg-serialize: expression props are not supported in SVG output (${prop.name}={${prop.code}})`);
    case "spread":
      throw new Error(`svg-serialize: spread props are not supported in SVG output ({...${prop.code}})`);
  }
}

function serializeStyleAttr(entries: readonly JsxStyleEntry[]): string {
  if (entries.length === 0) {
    return "";
  }
  const body = entries
    .map((entry) => `${cssPropertyName(entry.key)}: ${entry.value}`)
    .join("; ");
  return `style="${escapeXmlAttr(body)}"`;
}

/**
 * Escape a string for inclusion as character data inside an XML
 * element. Mirrors the standard `&`, `<`, `>` substitutions; quotes
 * are not relevant in element-content position.
 */
function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Escape a string for inclusion inside double-quoted XML attribute
 * value. Includes `"` (the delimiter) in addition to the element-
 * content set.
 */
function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function describeNode(node: JsxNode): string {
  switch (node.kind) {
    case "element":
      return `<${node.tag}>`;
    case "text":
      return `text(${JSON.stringify(node.value)})`;
    case "expr":
      return `expr(${node.code})`;
    case "fragment":
      return "fragment";
  }
}
