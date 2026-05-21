/** @file Figma SVG export precision serialization tests. */

import { serializeFigmaExportSvg } from "./figma-export-precision";
import { a, g, path, rect, svg } from "./element-primitives";

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

  it("fails when the SVG root lacks a viewBox", () => {
    const root = svg({}, rect({ width: 10, height: 10 }));

    expect(() => serializeFigmaExportSvg(root)).toThrow("requires an SVG viewBox");
  });
});
