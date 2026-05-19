/** @file Spec for fresh-export Message.type over Kiwi nodeChanges. */

import { createFigBuilderState } from "@higma-document-models/fig/builder";
import {
  assertNodeChangesMessageHeader,
  createNodeChangesMessageHeader,
  getNodeType,
} from "@higma-document-models/fig/domain";
import type { FigGuid } from "@higma-document-models/fig/types";
import { addNode, createEmptyFigDocument } from "@higma-document-io/fig";
import { decodeFigmaKiwiCanvas } from "@higma-figma-runtime/kiwi-canvas";
import type { FigDocumentContext } from "../context";
import { exportFig } from "./fig-exporter";

function firstCanvasGuid(context: FigDocumentContext): FigGuid {
  const canvas = context.document.nodeChanges.find((node) => getNodeType(node) === "CANVAS");
  if (canvas?.guid === undefined) {
    throw new Error("fresh-message-header test expected an initial CANVAS guid");
  }
  return canvas.guid;
}

function buildMinimalContext(): FigDocumentContext {
  const state = createFigBuilderState({
    nodeGuidCounter: { sessionID: 1, nextLocalID: 1 },
    pageGuidCounter: { sessionID: 0, nextLocalID: 2 },
  });
  const empty = createEmptyFigDocument("Page 1");
  return addNode({
    state,
    context: empty,
    pageGuid: firstCanvasGuid(empty),
    parentGuid: null,
    spec: { type: "FRAME", name: "Test", x: 0, y: 0, width: 100, height: 100 },
  }).context;
}

describe("fresh-export Message.type", () => {
  it("exportFig produces .fig with Message.type=NODE_CHANGES", async () => {
    const exported = await exportFig(buildMinimalContext());
    const decoded = await decodeFigmaKiwiCanvas(exported.data);
    const msg = decoded.message as { type?: { value?: number; name?: string } };
    expect(msg.type?.name).toBe("NODE_CHANGES");
    expect(typeof msg.type?.value).toBe("number");
  });

  it("decoded header passes assertNodeChangesMessageHeader", async () => {
    const exported = await exportFig(buildMinimalContext());
    const decoded = await decodeFigmaKiwiCanvas(exported.data);
    const msg = decoded.message as {
      type: { value: number; name: string };
      sessionID: number;
      ackID: number;
    };
    assertNodeChangesMessageHeader({
      type: msg.type as { value: number; name: "NODE_CHANGES" },
      sessionID: msg.sessionID,
      ackID: msg.ackID,
    });
  });

  it("createNodeChangesMessageHeader returns the canonical pair", () => {
    const header = createNodeChangesMessageHeader();
    expect(header.type.name).toBe("NODE_CHANGES");
    expect(header.type.value).toBeGreaterThan(0);
  });

  it("assertNodeChangesMessageHeader rejects JOIN_START", () => {
    expect(() =>
      assertNodeChangesMessageHeader({
        type: { value: 0, name: "JOIN_START" },
        sessionID: 1,
        ackID: 0,
      }),
    ).toThrow(/NODE_CHANGES/);
  });
});
