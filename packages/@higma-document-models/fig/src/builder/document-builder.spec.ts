/**
 * @file Spec — `addImage` and `addBlob` extend the document's image map
 * / blob array without touching node trees. Phase 3 of the SoT
 * consolidation removed the parallel `createEmptyFigDocument` /
 * `addPage` / `addNode` primitives that previously lived at this
 * layer; those concerns now live at the io layer (`@higma-document-io/
 * fig`) which owns the io-specific `NodeSpec` factory.
 */

import { addBlob, addImage } from "./index";
import { EMPTY_FIG_STYLE_REGISTRY } from "../domain";
import type { FigDesignDocument } from "../domain";

function emptyDoc(): FigDesignDocument {
  return {
    pages: [],
    components: new Map(),
    images: new Map(),
    blobs: [],
    metadata: null,
    styleRegistry: EMPTY_FIG_STYLE_REGISTRY,
  };
}

describe("addImage", () => {
  it("extends the image map", () => {
    const doc = addImage(emptyDoc(), "abc123", {
      ref: "abc123",
      data: new Uint8Array([1, 2, 3]),
      mimeType: "image/png",
    });
    expect(doc.images.size).toBe(1);
    expect(doc.images.get("abc123")?.data).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("is immutable — original doc is unchanged", () => {
    const before = emptyDoc();
    addImage(before, "key", { ref: "key", data: new Uint8Array(), mimeType: "image/png" });
    expect(before.images.size).toBe(0);
  });
});

describe("addBlob", () => {
  it("appends and returns the new index", () => {
    const step1 = addBlob(emptyDoc(), { bytes: [1, 2] });
    const step2 = addBlob(step1.doc, { bytes: [3, 4] });
    expect(step1.blobIndex).toBe(0);
    expect(step2.blobIndex).toBe(1);
    expect(step2.doc.blobs).toHaveLength(2);
  });

  it("is immutable — original doc.blobs is unchanged", () => {
    const before = emptyDoc();
    addBlob(before, { bytes: [9] });
    expect(before.blobs).toHaveLength(0);
  });
});
