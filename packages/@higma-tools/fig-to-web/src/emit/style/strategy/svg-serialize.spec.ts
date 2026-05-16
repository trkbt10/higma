/**
 * @file Lock down the JsxNode → standalone SVG serializer.
 *
 * The vector subtrees fig-to-web builds carry JsxNode-shaped string
 * props, style records, and nested elements. When externalised as
 * `.svg` assets they must round-trip to plain XML attributes that a
 * browser can parse without a TSX transform.
 */
import { el, styleProp, strProp, text } from "../../../lib/jsx-tree/builder";
import { serializeSvgDocument } from "./svg-serialize";

describe("serializeSvgDocument", () => {
  it("adds xmlns + xml prolog to the root <svg>", () => {
    const tree = el("svg", {
      props: [strProp("viewBox", "0 0 24 24")],
      children: [el("path", { props: [strProp("d", "M0 0H24V24H0Z")] })],
    });
    const out = serializeSvgDocument(tree);
    expect(out.startsWith(`<?xml version="1.0"`)).toBe(true);
    expect(out).toContain(`xmlns="http://www.w3.org/2000/svg"`);
    expect(out).toContain(`viewBox="0 0 24 24"`);
    expect(out).toContain(`<path d="M0 0H24V24H0Z" />`);
  });

  it("XML-escapes attribute values", () => {
    const tree = el("svg", {
      props: [strProp("data-author", `Pat "El Niño" Vale & Co <inc>`)],
    });
    const out = serializeSvgDocument(tree);
    expect(out).toContain(`data-author="Pat &quot;El Niño&quot; Vale &amp; Co &lt;inc&gt;"`);
  });

  it("inlines style props as kebab-case `style=\"...\"`", () => {
    const tree = el("svg", {
      props: [styleProp({ fillRule: "evenodd", strokeLinejoin: "round" })],
    });
    const out = serializeSvgDocument(tree);
    expect(out).toContain(`style="fill-rule: evenodd; stroke-linejoin: round"`);
  });

  it("XML-escapes text children", () => {
    const tree = el("svg", { children: [el("title", { children: [text("A & B < C")] })] });
    const out = serializeSvgDocument(tree);
    expect(out).toContain(`<title>A &amp; B &lt; C</title>`);
  });

  it("rejects non-<svg> roots", () => {
    const tree = el("div");
    expect(() => serializeSvgDocument(tree)).toThrow(/expected an <svg> root/);
  });

  it("rejects expression / spread props as unsupported in SVG output", () => {
    const tree = el("svg", {
      props: [{ kind: "expr", name: "data-dynamic", code: "value" }],
    });
    expect(() => serializeSvgDocument(tree)).toThrow(/expression props are not supported/);
  });
});
