/**
 * @file Per-feature spec for `buildDocument`.
 *
 * Scope: only the contracts unique to `buildDocument` itself —
 * topology (one page, every IR descendant becomes a FigDesignNode),
 * id-map registration, and asset installation. Per-feature CSS-to-Fig
 * fidelity (paints / strokes / radii / autoLayout / text) is asserted
 * by the primitive cases under `spec/cases/<feature>/`. Re-asserting
 * here would split the SoT between two suites.
 */
import { normalizeViewport } from "../normalize";
import { buildDocument } from "./build-document";
import { synthEl, synthViewport } from "../../spec/synth-snapshot";
import { staticFontResolver } from "../../spec/test-font-resolver";

describe("buildDocument — topology", () => {
  it("creates one page containing the viewport's root frame and its descendants", () => {
    const ir = normalizeViewport(
      synthViewport({
        children: [
          synthEl({
            id: "0/0",
            tag: "div",
            rect: { x: 0, y: 0, width: 100, height: 100 },
            children: [
              synthEl({
                id: "0/0/0",
                tag: "p",
                rect: { x: 0, y: 0, width: 100, height: 24 },
                text: "Hi",
              }),
            ],
          }),
        ],
      }),
      { fontResolver: staticFontResolver() },
    );
    const built = buildDocument(ir);
    expect(built.doc.pages).toHaveLength(1);
    const top = built.doc.pages[0]!.children;
    expect(top).toHaveLength(1);
    const body = top[0]!;
    expect(body.type).toBe("FRAME");
    expect((body.children ?? [])).toHaveLength(1);
    const card = body.children![0]!;
    expect(card.type).toBe("FRAME");
    expect((card.children ?? [])).toHaveLength(1);
    expect(card.children![0]!.type).toBe("TEXT");
  });

  it("registers IR id → FigNodeId mappings for every emitted node", () => {
    const ir = normalizeViewport(
      synthViewport({
        children: [
          synthEl({
            id: "div-a",
            tag: "div",
            rect: { x: 0, y: 0, width: 50, height: 50 },
          }),
        ],
      }),
      { fontResolver: staticFontResolver() },
    );
    const built = buildDocument(ir);
    expect(built.idMap.has("0")).toBe(true);
    expect(built.idMap.has("div-a")).toBe(true);
  });
});

describe("buildDocument — assets", () => {
  it("installs every IR asset into the document's images map", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const ir = normalizeViewport(
      synthViewport({
        assets: new Map([
          ["asset-1", { id: "asset-1", mime: "image/png", bytes }],
        ]),
        children: [
          synthEl({
            id: "0/0",
            tag: "img",
            rect: { x: 0, y: 0, width: 10, height: 10 },
            imageId: "asset-1",
            imageIds: ["asset-1"],
          }),
        ],
      }),
      { fontResolver: staticFontResolver() },
    );
    const built = buildDocument(ir);
    expect(built.doc.images.has("asset-1")).toBe(true);
    const img = built.doc.images.get("asset-1");
    expect(img?.mimeType).toBe("image/png");
    expect(img?.data).toBe(bytes);
  });
});
