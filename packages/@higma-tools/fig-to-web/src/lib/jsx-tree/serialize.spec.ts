/**
 * @file Hostile-input tests for the JSX tree serializer.
 *
 * These cover the cases that motivated the rewrite — Figma-author
 * content (TEXT characters, layer names, font names) flowing into
 * generated TSX must round-trip without breaking the parser or
 * leaking syntax. The helpers funnel everything through
 * `JSON.stringify`, which makes the safety property easy to assert:
 * the serialized form contains the *escaped* JS literal of the
 * input, never the literal characters themselves.
 */
import {
  el,
  exprProp,
  flagProp,
  spreadProp,
  strProp,
  styleProp,
  text,
} from "./builder";
import { serialize } from "./serialize";

describe("jsx-tree serialize", () => {
  it("self-closes elements with no children", () => {
    const out = serialize(el("div"));
    expect(out).toBe("<div />");
  });

  it("emits string props as JSON-escaped JSX expressions", () => {
    const payload = `</div><script>alert("xss")</script>`;
    const node = el("div", { props: [strProp("data-fig-name", payload)] });
    const out = serialize(node);
    // Property value sits inside `={"..."}` — a JS string-literal
    // expression, parsed by the JSX parser, never as raw markup.
    expect(out).toBe(`<div data-fig-name=${JSON.stringify(payload)} />`);
    // The JSON literal must round-trip back to the original
    // payload, proving no characters were lost or duplicated.
    const m = out.match(/data-fig-name=(".*") \/>/);
    expect(m).not.toBeNull();
    expect(JSON.parse((m as RegExpMatchArray)[1] as string)).toBe(payload);
  });

  it("wraps text children in JSON-escaped JSX expressions", () => {
    const payload = "hello </span><script>alert(1)</script>";
    const node = el("span", { children: [text(payload)] });
    const out = serialize(node);
    expect(out).toBe(`<span>{${JSON.stringify(payload)}}</span>`);
    const m = out.match(/<span>\{(".*")\}<\/span>/);
    expect(m).not.toBeNull();
    expect(JSON.parse((m as RegExpMatchArray)[1] as string)).toBe(payload);
  });

  it("renders backticks and ${} as a JSON string, not a template literal", () => {
    const payload = "`${process.env.SECRET}`";
    const out = serialize(el("span", { children: [text(payload)] }));
    expect(out).toBe(`<span>{${JSON.stringify(payload)}}</span>`);
    // The expression context is `{"..."}` — a JS string literal —
    // so the `${...}` form cannot interpolate.
    expect(out.startsWith(`<span>{"`)).toBe(true);
  });

  it("treats expr props as verbatim TS code", () => {
    const node = el("button", {
      props: [
        exprProp("onClick", "() => setActive(true)"),
        exprProp("aria-current", "active ? \"true\" : undefined"),
      ],
    });
    const out = serialize(node);
    expect(out).toBe(
      `<button onClick={() => setActive(true)} aria-current={active ? "true" : undefined} />`,
    );
  });

  it("renders style props with quoted string values and quoted non-identifier keys", () => {
    const node = el("div", {
      props: [
        styleProp({
          color: `var(--c1)`,
          "--token-x": `rgb(0, 0, 0)`,
          fontFamily: `"Inter"`,
        }),
      ],
    });
    const out = serialize(node);
    expect(out).toBe(
      `<div style={{color: "var(--c1)", "--token-x": "rgb(0, 0, 0)", fontFamily: "\\"Inter\\""}} />`,
    );
  });

  it("blocks indents nested element children but inlines text-only children", () => {
    const tree = el("div", {
      children: [
        el("span", { children: [text("hello")] }),
        el("span", { children: [text("world")] }),
      ],
    });
    const out = serialize(tree, { depth: 0 });
    expect(out).toBe(
      [
        "<div>",
        `  <span>{"hello"}</span>`,
        `  <span>{"world"}</span>`,
        "</div>",
      ].join("\n"),
    );
  });

  it("inline layout glues run spans without whitespace", () => {
    // The run-span emit needs no whitespace between segments so the
    // rendered <span> doesn't pick up visible space.
    const tree = el("span", {
      layout: "inline",
      children: [
        el("span", { layout: "inline", children: [text("Hello, ")] }),
        el("span", {
          layout: "inline",
          props: [styleProp({ color: "red" })],
          children: [text("world")],
        }),
        text("!"),
      ],
    });
    const out = serialize(tree);
    expect(out).toBe(
      `<span><span>{"Hello, "}</span><span style={{color: "red"}}>{"world"}</span>{"!"}</span>`,
    );
  });

  it("supports flag props and spread props", () => {
    const tree = el("div", {
      props: [flagProp("aria-hidden"), spreadProp("rest")],
    });
    expect(serialize(tree)).toBe(`<div aria-hidden {...rest} />`);
  });

  it("respects requested base depth", () => {
    const tree = el("div", { children: [text("x")] });
    expect(serialize(tree, { depth: 2 })).toBe(`    <div>{"x"}</div>`);
  });

  it("font-family value with double quotes round-trips through JSON escape", () => {
    // Reproduces the dangerous pattern in the old code:
    //   out.fontFamily = `"${run.fontFamily}"`
    // with `run.fontFamily` containing a `"`. The new contract is
    // that the caller hands the literal CSS string and the
    // serializer escapes it once via JSON, so the resulting JSX
    // value is parseable regardless of input contents.
    const family = `Comic"; background: url('//evil')`;
    const tree = el("span", { props: [styleProp({ fontFamily: family })] });
    const out = serialize(tree);
    // The CSS value is a single JS string literal — the surrounding
    // double-quote attempt cannot break out into a sibling property.
    expect(out).toBe(`<span style={{fontFamily: ${JSON.stringify(family)}}} />`);
    const m = out.match(/fontFamily: (".*?")\}\}/);
    expect(m).not.toBeNull();
    expect(JSON.parse((m as RegExpMatchArray)[1] as string)).toBe(family);
  });
});
