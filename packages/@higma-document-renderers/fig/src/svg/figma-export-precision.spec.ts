/** @file Figma SVG export precision serialization tests. */

import { projectFigmaExportTransforms } from "./figma-export-transform-projection";
import { serializeFigmaExportSvg } from "./figma-export-precision";
import { a, defs, g, mask, path, rect, svg } from "./element-primitives";

describe("serializeFigmaExportSvg", () => {
  it("rounds path coordinates from exported viewport position while serializing the element tree", () => {
    const root = svg(
      { viewBox: "0 0 300 200" },
      g(
        { transform: "translate(-165 -1047)" },
        g(
          { transform: "matrix(1,0,0,1,165,1047)" },
          path({
            d: "M110.6558609 71.11127L0.4018256 1.2054784Z",
            fill: "#000000",
            "stroke-width": "1.2054784",
          }),
        ),
      ),
    );

    const result = String(serializeFigmaExportSvg(root));

    expect(result).toContain('transform="translate(-165 -1047)"');
    expect(result).toContain('transform="matrix(1,0,0,1,165,1047)"');
    expect(result).toContain('d="M110.656 71.1113L0.401826 1.20548Z"');
    expect(result).toContain('stroke-width="1.20548"');
  });

  it("escapes attribute values during structured serialization", () => {
    const root = svg(
      { viewBox: "0 0 10 10" },
      a(
        { href: 'https://example.test/?a=1&b="x"' },
        rect({ x: 0, y: 0, width: 10, height: 10 }),
      ),
    );

    const result = String(serializeFigmaExportSvg(root));

    expect(result).toContain('href="https://example.test/?a=1&amp;b=&quot;x&quot;"');
    expect(result).not.toContain("&amp;amp;");
  });

  it("rounds preserved geometry translation transforms with the same viewport precision as coordinates", () => {
    const root = svg(
      { viewBox: "0 0 718 257" },
      rect({
        x: 0,
        y: 0,
        width: 114.142,
        height: 248,
        transform: "translate(447.000152588 364.000236511)",
      }),
    );

    const result = String(serializeFigmaExportSvg(root));

    expect(result).toContain('transform="translate(447 364)"');
  });

  it("rounds projected user-space mask regions after wrapper translation", () => {
    const root = svg(
      { viewBox: "0 0 718 257" },
      g(
        { transform: "translate(199 364)" },
        defs(
          mask(
            {
              id: "mask-1",
              style: "mask-type:alpha",
              maskUnits: "userSpaceOnUse",
              x: 1.8189894035458565e-12,
              y: -9.094947017729282e-13,
              width: 114,
              height: 248,
            },
            rect({
              x: 1.8189894035458565e-12,
              y: -9.094947017729282e-13,
              width: 114,
              height: 248,
              fill: "#d9d9d9",
            }),
          ),
        ),
      ),
    );

    const result = String(serializeFigmaExportSvg(projectFigmaExportTransforms(root)));

    expect(result).toContain('id="mask-1" style="mask-type:alpha" maskUnits="userSpaceOnUse" x="199" y="364" width="114" height="248"');
    expect(result).toContain('<rect x="199" y="364" width="114" height="248" fill="#d9d9d9"/>');
  });

  it("fails when the SVG root lacks a viewBox", () => {
    const root = svg({}, rect({ width: 10, height: 10 }));

    expect(() => serializeFigmaExportSvg(root)).toThrow("requires an SVG viewBox");
  });
});
