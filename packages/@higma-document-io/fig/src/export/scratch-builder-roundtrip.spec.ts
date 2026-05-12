/**
 * @file Spec — end-to-end scratch construction via the canonical
 * `@higma-document-io/fig` API: build a `FigDesignDocument` from
 * nothing, hand it to `exportFig`, and confirm the resulting `.fig`
 * binary parses back into a structurally equivalent document.
 *
 * This locks in the SoT pipeline:
 *
 *   createEmptyFigDesignDocument
 *     → addPage / addNode (io)
 *     → exportFig
 *     → .fig binary
 *
 * No `createFigFile()` / fig-file builder API is involved (it was
 * deleted in Phase 0b-2). If a future change reintroduces a separate
 * write path, this spec must continue to round-trip without touching it.
 */

import {
  addNode,
  createEmptyFigDesignDocument,
} from "@higma-document-io/fig";
import { createFigBuilderState } from "@higma-document-models/fig/builder";
import { exportFig } from "./fig-exporter";
import { parseFigFile } from "../parser";

describe("scratch-builder roundtrip", () => {
  it("createEmptyFigDesignDocument → addNode → exportFig produces a .fig parseable into the same shape", async () => {
    const state = createFigBuilderState({
      nodeIdCounter: { sessionID: 1, nextLocalID: 1 },
      pageIdCounter: { sessionID: 0, nextLocalID: 2 },
    });

    const empty = createEmptyFigDesignDocument("Page 1");
    const pageId = empty.pages[0]!.id;
    const frameStep = addNode({
      state,
      doc: empty,
      pageId,
      parentId: null,
      spec: {
        type: "FRAME",
        name: "Hero",
        x: 0,
        y: 0,
        width: 320,
        height: 200,
      },
    });

    const finalDoc = frameStep.doc;
    expect(finalDoc.pages).toHaveLength(1);
    expect(finalDoc.pages[0].children).toHaveLength(1);

    const exported = await exportFig(finalDoc);
    expect(exported.data.byteLength).toBeGreaterThan(0);

    const parsed = await parseFigFile(exported.data);
    // The parsed file must contain the FRAME we authored (and the
    // DOCUMENT + CANVAS structural nodes the exporter synthesises).
    const frameNodes = parsed.nodeChanges.filter((n) => n.type?.name === "FRAME");
    expect(frameNodes.length).toBe(1);
    expect(frameNodes[0].name).toBe("Hero");
  });
});
