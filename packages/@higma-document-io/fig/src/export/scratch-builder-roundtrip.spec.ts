/** @file Spec for scratch Kiwi document construction and export. */

import { createFigBuilderState } from "@higma-document-models/fig/builder";
import { getNodeType } from "@higma-document-models/fig/domain";
import type { FigGuid } from "@higma-document-models/fig/types";
import { addNode, createEmptyFigDocument } from "@higma-document-io/fig";
import { exportFig } from "./fig-exporter";
import { parseFigFile } from "../parser";

function firstCanvasGuid(context: ReturnType<typeof createEmptyFigDocument>): FigGuid {
  const canvas = context.document.nodeChanges.find((node) => getNodeType(node) === "CANVAS");
  if (canvas?.guid === undefined) {
    throw new Error("scratch-builder test expected an initial CANVAS guid");
  }
  return canvas.guid;
}

describe("scratch-builder roundtrip", () => {
  it("createEmptyFigDocument → addNode → exportFig emits parseable Kiwi nodeChanges", async () => {
    const state = createFigBuilderState({
      nodeGuidCounter: { sessionID: 1, nextLocalID: 1 },
      pageGuidCounter: { sessionID: 0, nextLocalID: 2 },
    });

    const empty = createEmptyFigDocument("Page 1");
    const frameStep = addNode({
      state,
      context: empty,
      pageGuid: firstCanvasGuid(empty),
      parentGuid: null,
      spec: {
        type: "FRAME",
        name: "Hero",
        x: 0,
        y: 0,
        width: 320,
        height: 200,
      },
    });

    const exported = await exportFig(frameStep.context);
    expect(exported.data.byteLength).toBeGreaterThan(0);

    const parsed = await parseFigFile(exported.data);
    const frameNodes = parsed.nodeChanges.filter((node) => getNodeType(node) === "FRAME");
    expect(frameNodes).toHaveLength(1);
    expect(frameNodes[0]?.name).toBe("Hero");
  });
});
