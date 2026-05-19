/**
 * @file Per-feature spec for `buildDocument`.
 *
 * Scope: only the contracts unique to `buildDocument` itself —
 * topology (one page, every IR descendant becomes a Kiwi FigNode),
 * GUID registration, and asset installation. Per-feature CSS-to-Fig
 * fidelity (paints / strokes / radii / autoLayout / text) is asserted
 * by the primitive cases under `spec/cases/<feature>/`. Re-asserting
 * here would split the SoT between two suites.
 */
import { normalizeViewport } from "../normalize";
import { buildDocument } from "./build-document";
import { synthEl, synthViewport } from "../../spec/synth-snapshot";
import { staticFontResolver } from "../../spec/test-font-resolver";
import type { FigDocumentContext } from "@higma-document-io/fig";
import type { FigNode } from "@higma-document-models/fig/types";

function documentCanvas(context: FigDocumentContext): FigNode {
  const canvases = context.document.nodeChanges.filter((node) => node.type.name === "CANVAS" && node.internalOnly !== true);
  if (canvases.length !== 1) {
    throw new Error(`expected exactly one visible CANVAS, got ${canvases.length}`);
  }
  return canvases[0]!;
}

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
                styleOverrides: { "line-height": "24px" },
                text: "Hi",
              }),
            ],
          }),
        ],
      }),
      { fontResolver: staticFontResolver() },
    );
    const built = buildDocument(ir);
    const page = documentCanvas(built.context);
    const top = built.context.document.childrenOf(page);
    expect(top).toHaveLength(1);
    const body = top[0]!;
    expect(body.type.name).toBe("FRAME");
    const bodyChildren = built.context.document.childrenOf(body);
    expect(bodyChildren).toHaveLength(1);
    const card = bodyChildren[0]!;
    expect(card.type.name).toBe("FRAME");
    const cardChildren = built.context.document.childrenOf(card);
    expect(cardChildren).toHaveLength(1);
    expect(cardChildren[0]!.type.name).toBe("TEXT");
  });

  it("registers IR id → FigGuid mappings for every emitted node", () => {
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
          ["abcdef", { id: "abcdef", mime: "image/png", bytes }],
        ]),
        children: [
          synthEl({
            id: "0/0",
            tag: "img",
            rect: { x: 0, y: 0, width: 10, height: 10 },
            imageId: "abcdef",
            imageIds: ["abcdef"],
          }),
        ],
      }),
      { fontResolver: staticFontResolver() },
    );
    const built = buildDocument(ir);
    expect(built.context.images.has("abcdef")).toBe(true);
    const img = built.context.images.get("abcdef");
    expect(img?.mimeType).toBe("image/png");
    expect(img?.data).toBe(bytes);
  });
});
