/**
 * @file Spec for the thumbnail rendering pipeline.
 *
 * Locks in the contract that the export pipeline:
 *   1. Calls `renderThumbnail` when `doc.thumbnailTarget` is set.
 *   2. Writes the returned PNG into the ZIP's `thumbnail.png`.
 *   3. Updates `meta.json`'s `client_meta.thumbnail_size` and
 *      `render_coordinates` to match.
 *   4. Re-emits `NodeChange.thumbnailInfo` on the DOCUMENT root so a
 *      subsequent load reconstructs `thumbnailTarget`.
 *   5. Refuses to silently ship a placeholder thumbnail when the target
 *      is set but the renderer is missing (AGENTS.md fail-fast policy).
 *
 * The spec uses a fake `renderThumbnail` that returns a fixed 2×3 PNG.
 * The real Node-side wiring (renderFigToSvg + resvg-js) is covered by
 * a companion spec in `@higma-document-renderers/fig` that depends on
 * both io and the renderer — putting it here would invert the package
 * boundary.
 */

import { encodeRgbaToPng, isPng } from "@higma-codecs/png";
import {
  addNode,
  createEmptyFigDesignDocument,
} from "@higma-document-io/fig";
import {
  createFigDesignDocument,
  createFigDesignDocumentFromLoaded,
} from "@higma-document-io/fig/context";
import { loadFigFile } from "@higma-document-io/fig/roundtrip";
import { createFigBuilderState } from "@higma-document-models/fig/builder";
import {
  parseId,
  type FigDesignDocument,
  type FigThumbnailTarget,
} from "@higma-document-models/fig/domain";
import { exportFig } from "./fig-exporter";
import { parseFigFile } from "../parser";
import type {
  FigThumbnailRenderRequest,
  FigThumbnailRenderResult,
} from "./thumbnail-pipeline";

// =============================================================================
// Test fixture — PNG produced via the codec SoT
// =============================================================================

/**
 * 2×3 opaque-red PNG built via `@higma-codecs/png` (`encodeRgbaToPng`).
 * Using the codec SoT — instead of a hand-baked byte array — means a
 * schema bump in the codec is not silently masked by a frozen
 * fixture. The exporter compares byte-equality after roundtrip, so
 * accidental re-encoding by `saveFigFile` still fails this spec.
 */
const FAKE_PNG = (() => {
  const width = 2;
  const height = 3;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 0xff;
    rgba[i + 1] = 0x00;
    rgba[i + 2] = 0x00;
    rgba[i + 3] = 0xff;
  }
  const png = encodeRgbaToPng(rgba, width, height);
  if (!isPng(png)) {
    throw new Error("encodeRgbaToPng produced bytes that do not start with the PNG magic");
  }
  return png;
})();

// =============================================================================
// Helpers
// =============================================================================

function buildDocumentWithFrame(): { doc: FigDesignDocument; frameId: string } {
  const state = createFigBuilderState({
    nodeIdCounter: { sessionID: 17, nextLocalID: 1 },
    pageIdCounter: { sessionID: 0, nextLocalID: 2 },
  });
  const empty = createEmptyFigDesignDocument("Cover Page");
  const pageId = empty.pages[0]!.id;
  const step = addNode({
    state,
    doc: empty,
    pageId,
    parentId: null,
    spec: {
      type: "FRAME",
      name: "Hero",
      x: 12,
      y: 34,
      width: 320,
      height: 200,
    },
  });
  const frame = step.doc.pages[0]!.children[0]!;
  return { doc: step.doc, frameId: frame.id };
}

type RendererRecord = {
  readonly call: FigThumbnailRenderRequest;
};

function makeRecordingRenderer(
  result: FigThumbnailRenderResult,
): { renderer: (req: FigThumbnailRenderRequest) => Promise<FigThumbnailRenderResult>; calls: RendererRecord[] } {
  const calls: RendererRecord[] = [];
  return {
    renderer: async (req) => {
      calls.push({ call: req });
      return result;
    },
    calls,
  };
}

// =============================================================================
// Specs
// =============================================================================

describe("export thumbnail pipeline", () => {
  it("rasterises the thumbnailTarget frame and writes it into the ZIP", async () => {
    const { doc, frameId } = buildDocumentWithFrame();
    const frameGuid = parseId(frameId);
    const target: FigThumbnailTarget = {
      nodeID: frameGuid,
      thumbnailVersion: "v-test-1",
    };
    const docWithTarget: FigDesignDocument = { ...doc, thumbnailTarget: target };

    const { renderer, calls } = makeRecordingRenderer({
      png: FAKE_PNG,
      thumbnailSize: { width: 2, height: 3 },
      // Renderer returns the canonical canvas-space coords back unchanged.
      renderCoordinates: { x: 12, y: 34, width: 320, height: 200 },
    });

    const exported = await exportFig(docWithTarget, { renderThumbnail: renderer });

    // The renderer must have been invoked exactly once, with bounds
    // composed from the frame's `transform` + `size`.
    expect(calls).toHaveLength(1);
    expect(calls[0].call.target.id).toBe(frameId);
    expect(calls[0].call.canvasBounds).toEqual({
      x: 12,
      y: 34,
      width: 320,
      height: 200,
    });
    expect(calls[0].call.maxDimension).toBe(400);

    // Reload via the raw fig-family loader so we can inspect the
    // thumbnail PNG bytes the exporter wrote into the ZIP.
    const reloaded = await loadFigFile(exported.data);
    expect(reloaded.thumbnail).not.toBeNull();
    expect(reloaded.thumbnail!).toEqual(FAKE_PNG);
    expect(reloaded.metadata?.clientMeta?.thumbnailSize).toEqual({ width: 2, height: 3 });
    expect(reloaded.metadata?.clientMeta?.renderCoordinates).toEqual({
      x: 12,
      y: 34,
      width: 320,
      height: 200,
    });

    // The DOCUMENT NodeChange must carry the same `thumbnailInfo` —
    // otherwise a second load wouldn't reconstruct `thumbnailTarget`.
    const parsed = await parseFigFile(exported.data);
    const documentNode = parsed.nodeChanges.find((n) => n.type?.name === "DOCUMENT");
    expect(documentNode).toBeDefined();
    // `FigNode` carries a `[key: string]: unknown` index signature, so
    // `thumbnailInfo` is readable directly — no cast needed.
    expect(documentNode!["thumbnailInfo"]).toEqual({
      nodeID: frameGuid,
      thumbnailVersion: "v-test-1",
    });

    // And the round-trip back to the domain reconstructs `thumbnailTarget`.
    const reloadedDoc = createFigDesignDocumentFromLoaded(reloaded);
    expect(reloadedDoc.thumbnailTarget).toEqual({
      nodeID: frameGuid,
      thumbnailVersion: "v-test-1",
    });
  });

  it("falls back to the bounds-derived renderCoordinates when the renderer omits them", async () => {
    const { doc, frameId } = buildDocumentWithFrame();
    const target: FigThumbnailTarget = { nodeID: parseId(frameId) };
    const docWithTarget: FigDesignDocument = { ...doc, thumbnailTarget: target };

    const { renderer } = makeRecordingRenderer({
      png: FAKE_PNG,
      thumbnailSize: { width: 2, height: 3 },
      // renderCoordinates omitted — exporter must use canvasBounds.
    });

    const exported = await exportFig(docWithTarget, { renderThumbnail: renderer });
    const reloaded = await loadFigFile(exported.data);
    expect(reloaded.metadata?.clientMeta?.renderCoordinates).toEqual({
      x: 12,
      y: 34,
      width: 320,
      height: 200,
    });
  });

  it("throws when thumbnailTarget is set but no renderThumbnail is supplied", async () => {
    const { doc, frameId } = buildDocumentWithFrame();
    const docWithTarget: FigDesignDocument = {
      ...doc,
      thumbnailTarget: { nodeID: parseId(frameId) },
    };
    await expect(exportFig(docWithTarget)).rejects.toThrow(/renderThumbnail.*was not provided/);
  });

  it("throws when thumbnailTarget points at a nodeID that does not exist", async () => {
    const { doc } = buildDocumentWithFrame();
    const docWithStaleTarget: FigDesignDocument = {
      ...doc,
      thumbnailTarget: { nodeID: { sessionID: 999, localID: 999 } },
    };
    await expect(
      exportFig(docWithStaleTarget, {
        renderThumbnail: async () => {
          throw new Error("should not be called");
        },
      }),
    ).rejects.toThrow(/not found in any page/);
  });

  it("rejects renderer output that lacks the PNG magic", async () => {
    const { doc, frameId } = buildDocumentWithFrame();
    const docWithTarget: FigDesignDocument = {
      ...doc,
      thumbnailTarget: { nodeID: parseId(frameId) },
    };
    await expect(
      exportFig(docWithTarget, {
        renderThumbnail: async () => ({
          png: new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
          thumbnailSize: { width: 1, height: 1 },
        }),
      }),
    ).rejects.toThrow(/PNG magic/);
  });

  it("preserves placeholder thumbnail behaviour when no thumbnailTarget is set", async () => {
    const { doc } = buildDocumentWithFrame();
    const { renderer, calls } = makeRecordingRenderer({
      png: FAKE_PNG,
      thumbnailSize: { width: 2, height: 3 },
    });
    const exported = await exportFig(doc, { renderThumbnail: renderer });
    expect(calls).toHaveLength(0);
    const reloaded = await loadFigFile(exported.data);
    // The fresh-export placeholder is a 1×1 grayscale PNG — definitely
    // not our 2×3 fixture.
    expect(reloaded.thumbnail).not.toBeNull();
    expect(reloaded.thumbnail!).not.toEqual(FAKE_PNG);
    // No metadata mutation either.
    expect(reloaded.metadata?.clientMeta?.thumbnailSize).not.toEqual({ width: 2, height: 3 });
  });
});

describe("loaded document thumbnailTarget surfacing", () => {
  it("does not invent a thumbnailTarget when the loaded DOCUMENT has no thumbnailInfo", async () => {
    // Build a fresh doc, export it (no thumbnailTarget), reload, and
    // confirm the reloaded domain doc also has no thumbnailTarget.
    const { doc } = buildDocumentWithFrame();
    const exported = await exportFig(doc);
    const reloadedDoc = await createFigDesignDocument(exported.data);
    expect(reloadedDoc.thumbnailTarget).toBeUndefined();
  });
});
