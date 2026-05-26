/** @file Non-React Fig editor store globalThis publication tests. */
// @vitest-environment jsdom

import { createFigDocumentContextFromNodeChanges } from "@higma-document-io/fig";
import {
  FIG_EDITOR_GLOBAL_THIS_OPERATION_SURFACE_KEY,
  type FigEditorOperationSurfaceGlobalThis,
} from "../operation-surface/fig-editor-operation-surface-types";
import {
  readFigEditorOperationSurfaceFromGlobalThis,
  requireFigEditorOperationSurfaceFromGlobalThis,
} from "../operation-surface/fig-editor-global-this-operation-surface";
import {
  sectionDocument,
  sectionGuid,
  sectionNode,
  sectionPage,
} from "../panels/sections/section-specimen";
import { createGlobalThisPublishedFigEditorStore } from "./fig-editor-store-global-this-publication";

const PAGE_GUID = sectionGuid(101);
const RECTANGLE_GUID = sectionGuid(102);

function createPublicationSpecContext() {
  return createFigDocumentContextFromNodeChanges({
    nodeChanges: [
      sectionDocument(),
      sectionPage({ guid: PAGE_GUID }),
      sectionNode("RECTANGLE", {
        guid: RECTANGLE_GUID,
        parentIndex: { guid: PAGE_GUID, position: "a" },
        name: "Published Rectangle",
      }),
    ],
    blobs: [],
    images: new Map(),
    metadata: null,
  });
}

describe("createGlobalThisPublishedFigEditorStore", () => {
  afterEach(() => {
    (globalThis as FigEditorOperationSurfaceGlobalThis)[FIG_EDITOR_GLOBAL_THIS_OPERATION_SURFACE_KEY] = undefined;
  });

  it("publishes the store-owned operation surface on globalThis", () => {
    const session = createGlobalThisPublishedFigEditorStore({
      context: createPublicationSpecContext(),
    });
    try {
      expect(requireFigEditorOperationSurfaceFromGlobalThis()).toBe(session.store.operationSurface);
    } finally {
      session.dispose();
    }
  });

  it("removes only its own store-owned operation surface on dispose", () => {
    const session = createGlobalThisPublishedFigEditorStore({
      context: createPublicationSpecContext(),
    });
    session.dispose();
    expect(readFigEditorOperationSurfaceFromGlobalThis()).toBeUndefined();
  });

  it("rejects a second store-owned operation surface while one is published", () => {
    const session = createGlobalThisPublishedFigEditorStore({
      context: createPublicationSpecContext(),
    });
    try {
      expect(() => createGlobalThisPublishedFigEditorStore({
        context: createPublicationSpecContext(),
      })).toThrow("globalThis.higmaFigEditor is already published");
    } finally {
      session.dispose();
    }
  });
});
