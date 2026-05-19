/** @file FigPageRenderer integration test for a real .fig fixture. */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createFigDocumentContext, figDocumentResources } from "@higma-document-io/fig";
import { findNodesByType } from "@higma-document-models/fig/domain";
import { FigPageRenderer } from "./FigPageRenderer";

const SPEC_DIR = dirname(fileURLToPath(import.meta.url));
const FIG_FILE = resolve(
  SPEC_DIR,
  "../../../../../@higma-document-renderers/fig/fixtures/frame-properties/frame-properties.fig",
);

describe("FigPageRenderer real fig fixture", () => {
  it("renders FRAME decoration data from Kiwi document context", async () => {
    const context = await createFigDocumentContext(readFileSync(FIG_FILE));
    const page = findNodesByType(context.document, "CANVAS")[0];
    if (page === undefined) {
      throw new Error("FigPageRenderer realfig spec requires a CANVAS node");
    }
    const html = renderToStaticMarkup(createElement(FigPageRenderer, {
      page,
      canvasWidth: 2400,
      canvasHeight: 600,
      viewportX: 0,
      viewportY: 0,
      viewportWidth: 2400,
      viewportHeight: 600,
      viewportScale: 1,
      resources: figDocumentResources(context),
    }));

    expect(html).toContain("<svg");
    expect(html).not.toContain("data:image/svg+xml");
    expect(html).toMatch(/fill="#3380e6"|fill="rgb\(51, ?128, ?230\)"/i);
    expect(html).toMatch(/<filter\b/);
    expect(html).toMatch(/<mask\b/);
  });
});
