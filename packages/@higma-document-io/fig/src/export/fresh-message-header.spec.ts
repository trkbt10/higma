/**
 * @file Regression guard — `exportFig`-built `.fig` files must carry
 * `Message.type = NODE_CHANGES`.
 *
 * Background: a previous regression hard-coded
 * `messageHeader.type = { value: 0, name: "FULL_DOCUMENT" }` in the
 * fresh-export path. `"FULL_DOCUMENT"` is not a name in the bundled
 * Kiwi `MessageType` enum, and value 0 is `JOIN_START` (a session-
 * sync message). Figma's importer reads the file expecting a
 * document, sees `JOIN_START`, and rejects the file with "Internal
 * error during import". Every generator-built fixture failed to
 * import for that reason — but our own parser tolerated it (the
 * enum reverse-lookup gave back the canonical name).
 *
 * This test locks the invariant at the SoT seam: `exportFig` of any
 * fresh document must produce a file whose top-level
 * `Message.type.name === "NODE_CHANGES"` and whose value matches the
 * bundled schema's enum. The factory
 * `createNodeChangesMessageHeader` (in
 * `@higma-document-models/fig/domain`) is the only sanctioned
 * synthesiser; this test ensures the exporter consumes it.
 */

import {
  createEmptyFigDesignDocument,
  addNode,
} from "@higma-document-io/fig";
import { createFigBuilderState } from "@higma-document-models/fig/builder";
import {
  createNodeChangesMessageHeader,
  assertNodeChangesMessageHeader,
} from "@higma-document-models/fig/domain";
import { exportFig } from "./fig-exporter";
import { decodeFigmaKiwiCanvas } from "@higma-figma-runtime/kiwi-canvas";

function buildMinimalDoc() {
  const state = createFigBuilderState({
    nodeIdCounter: { sessionID: 1, nextLocalID: 1 },
    pageIdCounter: { sessionID: 0, nextLocalID: 2 },
  });
  const empty = createEmptyFigDesignDocument("Page 1");
  const pageId = empty.pages[0]!.id;
  const step = addNode({
    state,
    doc: empty,
    pageId,
    parentId: null,
    spec: { type: "FRAME", name: "Test", x: 0, y: 0, width: 100, height: 100 },
  });
  return step.doc;
}

describe("fresh-export Message.type", () => {
  it("exportFig produces .fig with Message.type=NODE_CHANGES", async () => {
    const doc = buildMinimalDoc();
    const exported = await exportFig(doc);
    const decoded = await decodeFigmaKiwiCanvas(exported.data);
    const msg = decoded.message as { type?: { value?: number; name?: string } };
    expect(msg.type?.name).toBe("NODE_CHANGES");
    expect(typeof msg.type?.value).toBe("number");
  });

  it("decoded header passes assertNodeChangesMessageHeader", async () => {
    const doc = buildMinimalDoc();
    const exported = await exportFig(doc);
    const decoded = await decodeFigmaKiwiCanvas(exported.data);
    const msg = decoded.message as {
      type: { value: number; name: string };
      sessionID: number;
      ackID: number;
    };
    // The decoded names come from the schema's reverse lookup, so they
    // are guaranteed to be valid `MessageType` names. The assertion below
    // narrows that to the document-content variant.
    assertNodeChangesMessageHeader({
      type: msg.type as { value: number; name: "NODE_CHANGES" },
      sessionID: msg.sessionID,
      ackID: msg.ackID,
    });
  });

  it("createNodeChangesMessageHeader returns the canonical (value, name) pair", () => {
    const header = createNodeChangesMessageHeader();
    expect(header.type.name).toBe("NODE_CHANGES");
    expect(header.type.value).toBeGreaterThan(0); // value 0 is JOIN_START — guarding against the regression
  });

  it("assertNodeChangesMessageHeader rejects JOIN_START (the regressed value)", () => {
    expect(() =>
      assertNodeChangesMessageHeader({
        type: { value: 0, name: "JOIN_START" },
        sessionID: 1,
        ackID: 0,
      }),
    ).toThrow(/NODE_CHANGES/);
  });
});
