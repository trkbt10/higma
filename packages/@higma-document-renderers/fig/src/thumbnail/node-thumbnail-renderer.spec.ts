/**
 * @file End-to-end spec for the Node-side thumbnail renderer.
 *
 * Builds a fresh `FigDesignDocument`, marks a frame as the thumbnail
 * target, hands the result to `exportFig` with the real
 * `createNodeThumbnailRenderer()` (resvg-js backed), and verifies:
 *
 *   - The ZIP carries a non-trivial PNG (placeholder is 67 bytes; a
 *     real render is at least an order of magnitude larger).
 *   - The PNG starts with the PNG magic.
 *   - `meta.json`'s `client_meta.thumbnail_size` and
 *     `render_coordinates` match what the renderer reported.
 *   - The DOCUMENT NodeChange carries `thumbnailInfo` pointing at the
 *     target's GUID — so a subsequent load reconstructs
 *     `thumbnailTarget`.
 *
 * The fixture deliberately avoids TEXT nodes so the renderer can run
 * without a font loader. Text-bearing frames need a real `fontLoader`
 * passed to `createNodeThumbnailRenderer({ fontLoader })`.
 */

import { isPng } from "@higma-codecs/png";
import { addNode, createEmptyFigDesignDocument, exportFig } from "@higma-document-io/fig";
import { loadFigFile } from "@higma-document-io/fig/roundtrip";
import { parseFigFile } from "@higma-document-io/fig/parser";
import { createFigBuilderState } from "@higma-document-models/fig/builder";
import {
  parseId,
  type FigDesignDocument,
  type FigThumbnailTarget,
} from "@higma-document-models/fig/domain";
import { createNodeThumbnailRenderer } from "./node-thumbnail-renderer";

describe("createNodeThumbnailRenderer (end-to-end)", () => {
  it("rasterises a fresh FRAME via resvg-js and embeds the PNG + meta.json bounds", async () => {
    const state = createFigBuilderState({
      nodeIdCounter: { sessionID: 9, nextLocalID: 1 },
      pageIdCounter: { sessionID: 0, nextLocalID: 2 },
    });
    const empty = createEmptyFigDesignDocument("Cover");
    const pageId = empty.pages[0]!.id;
    const step = addNode({
      state,
      doc: empty,
      pageId,
      parentId: null,
      spec: {
        type: "FRAME",
        name: "Cover Frame",
        x: 20,
        y: 40,
        width: 320,
        height: 240,
      },
    });
    const frame = step.doc.pages[0]!.children[0]!;
    const target: FigThumbnailTarget = { nodeID: parseId(frame.id) };
    const docWithTarget: FigDesignDocument = { ...step.doc, thumbnailTarget: target };

    const renderer = createNodeThumbnailRenderer();
    const exported = await exportFig(docWithTarget, { renderThumbnail: renderer });

    // The 1×1 placeholder weighs in around 67 bytes. A 400×300 PNG
    // rendered through resvg-js is at least several hundred bytes, so
    // this floor is generous but guarantees we're not silently
    // shipping the placeholder.
    const reloaded = await loadFigFile(exported.data);
    expect(reloaded.thumbnail).not.toBeNull();
    expect(isPng(reloaded.thumbnail!)).toBe(true);
    expect(reloaded.thumbnail!.length).toBeGreaterThan(200);

    // The longest axis (320) gets clamped to 400 — but since 320 < 400
    // the renderer keeps original dimensions. Verify both dimensions
    // round-trip exactly through meta.json.
    expect(reloaded.metadata?.clientMeta?.thumbnailSize).toEqual({
      width: 320,
      height: 240,
    });
    expect(reloaded.metadata?.clientMeta?.renderCoordinates).toEqual({
      x: 20,
      y: 40,
      width: 320,
      height: 240,
    });

    const parsed = await parseFigFile(exported.data);
    const documentNode = parsed.nodeChanges.find((n) => n.type?.name === "DOCUMENT");
    expect(documentNode).toBeDefined();
    expect(documentNode!["thumbnailInfo"]).toEqual({ nodeID: target.nodeID });
  });

  it("clamps the longest axis to maxDimension while preserving aspect ratio", async () => {
    const state = createFigBuilderState({
      nodeIdCounter: { sessionID: 7, nextLocalID: 1 },
      pageIdCounter: { sessionID: 0, nextLocalID: 2 },
    });
    const empty = createEmptyFigDesignDocument("Wide");
    const pageId = empty.pages[0]!.id;
    const step = addNode({
      state,
      doc: empty,
      pageId,
      parentId: null,
      spec: {
        type: "FRAME",
        name: "Wide Frame",
        x: 0,
        y: 0,
        width: 1600,
        height: 800,
      },
    });
    const frame = step.doc.pages[0]!.children[0]!;
    const docWithTarget: FigDesignDocument = {
      ...step.doc,
      thumbnailTarget: { nodeID: parseId(frame.id) },
    };

    const exported = await exportFig(docWithTarget, {
      renderThumbnail: createNodeThumbnailRenderer(),
    });
    const reloaded = await loadFigFile(exported.data);

    // Longest axis = 1600 → clamps to 400 at scale 0.25.
    // Smaller axis = 800 × 0.25 = 200.
    expect(reloaded.metadata?.clientMeta?.thumbnailSize).toEqual({ width: 400, height: 200 });
    expect(reloaded.metadata?.clientMeta?.renderCoordinates).toEqual({
      x: 0,
      y: 0,
      width: 1600,
      height: 800,
    });
  });
});
