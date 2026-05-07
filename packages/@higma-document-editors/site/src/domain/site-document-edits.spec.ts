/**
 * @file Site document edit application tests.
 */

import { createSiteEditorTestDocument } from "../../spec/shared/site-editor-test-fixture";
import { applySiteUnitMovesToNodeChanges } from "@higma-document-renderers/site";

function findNode(nodeChanges: readonly unknown[], id: string): Record<string, unknown> {
  const node = nodeChanges.find((item) => {
    const record = item as Record<string, unknown>;
    const guid = record.guid as { readonly sessionID: number; readonly localID: number } | undefined;
    return guid ? `${guid.sessionID}:${guid.localID}` === id : false;
  });
  if (!node) {
    throw new Error(`Missing node ${id}`);
  }
  return node as Record<string, unknown>;
}

function readTransformTranslation(node: Record<string, unknown>): { readonly x: number; readonly y: number } {
  const transform = node.transform as { readonly m02: number; readonly m12: number } | undefined;
  if (!transform) {
    throw new Error("Expected node transform");
  }
  return { x: transform.m02, y: transform.m12 };
}

describe("applySiteUnitMovesToNodeChanges", () => {
  it("writes direct move operations to the moved node transform", () => {
    const document = createSiteEditorTestDocument();
    const edited = applySiteUnitMovesToNodeChanges(document.canvas.nodeChanges, [
      { unitId: "0:2", deltaX: 30, deltaY: 40 },
    ]);

    expect(readTransformTranslation(findNode(edited, "0:2"))).toEqual({ x: 78, y: 136 });
    expect(readTransformTranslation(findNode(edited, "0:3"))).toEqual({ x: 24, y: 32 });
  });
});
