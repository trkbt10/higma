/**
 * @file Hostile-input tests for the HTML serializer.
 */
import { comment, doctype, el, raw, text } from "./builder";
import { serialize } from "./serialize";

describe("html-tree serialize", () => {
  it("emits doctype + nested elements", () => {
    const out = serialize([
      doctype(),
      el("html", { lang: "en" }, [
        el("head", {}, [el("title", {}, [text("hi")])]),
        el("body", {}, [text("hello")]),
      ]),
    ]);
    expect(out).toBe(
      [
        "<!DOCTYPE html>",
        `<html lang="en">`,
        "  <head>",
        "    <title>hi</title>",
        "  </head>",
        "  <body>hello</body>",
        "</html>",
      ].join("\n"),
    );
  });

  it("escapes < / > / & in text content", () => {
    const out = serialize([el("p", {}, [text(`Tom & Jerry <script>alert(1)</script>`)])]);
    expect(out).toBe(`<p>Tom &amp; Jerry &lt;script&gt;alert(1)&lt;/script&gt;</p>`);
  });

  it("escapes <, >, &, double quotes in attribute values", () => {
    const out = serialize([el("a", { href: `https://example.com/?q="bad"&x=<script>` })]);
    expect(out).toBe(
      `<a href="https://example.com/?q=&quot;bad&quot;&amp;x=&lt;script&gt;"></a>`,
    );
  });

  it("font-link href with hostile family name escapes through the boundary", () => {
    // The previous string-build path interpolated `${href}` directly
    // into `<link href="${href}" />`. With the typed builder, even a
    // family that survives encodeURIComponent (none normally do, but
    // the safety must not depend on that) flows through attribute
    // escape.
    const evil = `https://x/?a="><script>alert(1)</script>`;
    const out = serialize([el("link", { rel: "stylesheet", href: evil })]);
    expect(out).toBe(
      `<link rel="stylesheet" href="https://x/?a=&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;" />`,
    );
  });

  it("self-closes void elements (link, meta, br, etc.)", () => {
    const out = serialize([el("meta", { charset: "utf-8" }), el("br"), el("hr")]);
    expect(out).toBe(`<meta charset="utf-8" />\n<br />\n<hr />`);
  });

  it("literal nodes pass through verbatim — used for trusted SVG bodies", () => {
    const svg = `<svg viewBox="0 0 1 1"><path d="M0 0L1 1"/></svg>`;
    const out = serialize([el("body", {}, [raw(svg)])]);
    expect(out).toBe(`<body>${svg}</body>`);
  });

  it("comments collapse `--` so they cannot terminate early", () => {
    const out = serialize([comment(`-- hidden -->`)]);
    expect(out).toBe(`<!-- - - hidden - -> -->`);
  });

  it("omits attributes whose value is undefined", () => {
    const out = serialize([el("input", { type: "text", value: undefined })]);
    expect(out).toBe(`<input type="text" />`);
  });
});
