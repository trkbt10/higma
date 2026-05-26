/** @file FigDocumentContext explicit Kiwi source document tests. */

import type { FigBlob } from "@higma-document-models/fig/domain";
import type { FigGuid, FigNode, FigPaint } from "@higma-document-models/fig/types";
import { PAINT_TYPE_VALUES } from "@higma-document-models/fig/constants";
import { resolveStyledPaint } from "@higma-document-models/fig/symbols";
import {
  createFigDocumentContextFromNodeChanges,
  replaceFigDocumentContextNodeChanges,
  replaceFigDocumentContextNodeChangesAfterTransformOnlyEdit,
} from "./document-context";

function solidPaint(r: number, g: number, b: number): FigPaint {
  return {
    type: { value: PAINT_TYPE_VALUES.SOLID, name: "SOLID" },
    color: { r, g, b, a: 1 },
  };
}

function node(overrides: Partial<FigNode>): FigNode {
  return {
    guid: { sessionID: 0, localID: 0 },
    phase: { value: 0, name: "CREATED" },
    type: { value: -1, name: "RECTANGLE" },
    ...overrides,
  };
}

function emptyImages(): ReadonlyMap<string, never> {
  return new Map();
}

function sourceDocument(nodeChanges: readonly FigNode[], blobs: readonly FigBlob[] = []) {
  return {
    nodeChanges,
    blobs,
    images: emptyImages(),
  };
}

describe("FigDocumentContext explicit Kiwi source documents", () => {
  it("feeds the same source set into SymbolResolver and FigStyleRegistry", () => {
    const symbolGuid: FigGuid = { sessionID: 80, localID: 1 };
    const childGuid: FigGuid = { sessionID: 80, localID: 2 };
    const instance = node({
      guid: { sessionID: 81, localID: 1 },
      type: { value: -1, name: "INSTANCE" },
      symbolData: { symbolID: symbolGuid },
    });
    const styledConsumer = node({
      guid: { sessionID: 81, localID: 2 },
      styleIdForFill: { assetRef: { key: "source-fill" } },
      fillPaints: [solidPaint(1, 1, 1)],
    });
    const symbol = node({
      guid: symbolGuid,
      type: { value: -1, name: "SYMBOL" },
      name: "Explicit source symbol",
    });
    const child = node({
      guid: childGuid,
      parentIndex: { guid: symbolGuid, position: "!" },
      name: "Explicit source child",
    });
    const style = node({
      guid: { sessionID: 82, localID: 1 },
      styleType: { value: 1, name: "FILL" },
      key: "source-fill",
      fillPaints: [solidPaint(0, 0, 0)],
    });
    const context = createFigDocumentContextFromNodeChanges({
      nodeChanges: [instance, styledConsumer],
      blobs: [],
      images: emptyImages(),
      metadata: null,
      kiwiSourceDocuments: [sourceDocument([symbol, child, style])],
    });

    const resolved = context.symbolResolver.resolveInstance(instance);
    const resolvedPaint = resolveStyledPaint(
      styledConsumer.styleIdForFill,
      styledConsumer.fillPaints,
      context.styleRegistry,
    );

    expect(context.kiwiSourceDocuments).toHaveLength(1);
    expect(resolved.children).toHaveLength(1);
    expect(resolved.children[0]!.guid).toEqual(childGuid);
    expect(resolvedPaint).toEqual([solidPaint(0, 0, 0)]);
  });

  it("preserves explicit Kiwi source documents when re-indexing edited nodeChanges", () => {
    const symbolGuid: FigGuid = { sessionID: 83, localID: 1 };
    const childGuid: FigGuid = { sessionID: 83, localID: 2 };
    const instance = node({
      guid: { sessionID: 84, localID: 1 },
      type: { value: -1, name: "INSTANCE" },
      symbolData: { symbolID: symbolGuid },
    });
    const symbol = node({
      guid: symbolGuid,
      type: { value: -1, name: "SYMBOL" },
    });
    const child = node({
      guid: childGuid,
      parentIndex: { guid: symbolGuid, position: "!" },
    });
    const context = createFigDocumentContextFromNodeChanges({
      nodeChanges: [instance],
      blobs: [],
      images: emptyImages(),
      metadata: null,
      kiwiSourceDocuments: [sourceDocument([symbol, child])],
    });
    const next = replaceFigDocumentContextNodeChanges({
      context,
      nodeChanges: [instance],
    });

    const resolved = next.symbolResolver.resolveInstance(instance);

    expect(next.kiwiSourceDocuments).toHaveLength(1);
    expect(resolved.children[0]!.guid).toEqual(childGuid);
  });

  it("rebuilds SymbolResolver over edited nodeChanges while preserving transform-independent style lookup", () => {
    const symbolGuid: FigGuid = { sessionID: 85, localID: 1 };
    const instanceGuid: FigGuid = { sessionID: 85, localID: 2 };
    const symbol = node({
      guid: symbolGuid,
      type: { value: -1, name: "SYMBOL" },
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    });
    const instance = node({
      guid: instanceGuid,
      type: { value: -1, name: "INSTANCE" },
      symbolData: { symbolID: symbolGuid },
    });
    const context = createFigDocumentContextFromNodeChanges({
      nodeChanges: [symbol, instance],
      blobs: [],
      images: emptyImages(),
      metadata: null,
    });
    const movedSymbol = {
      ...symbol,
      transform: { m00: 1, m01: 0, m02: 12, m10: 0, m11: 1, m12: 4 },
    };
    const next = replaceFigDocumentContextNodeChangesAfterTransformOnlyEdit({
      context,
      nodeChanges: [movedSymbol, instance],
      changes: [{ before: symbol, after: movedSymbol }],
    });

    const resolved = next.symbolResolver.resolveInstanceTarget(instance);

    expect(next.styleRegistry).toBe(context.styleRegistry);
    expect(resolved?.node).toBe(movedSymbol);
  });

  it("rejects transform-only re-indexing when another Kiwi node field changed", () => {
    const before = node({
      guid: { sessionID: 86, localID: 1 },
      name: "Before",
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    });
    const after = {
      ...before,
      name: "After",
      transform: { m00: 1, m01: 0, m02: 1, m10: 0, m11: 1, m12: 1 },
    };
    const context = createFigDocumentContextFromNodeChanges({
      nodeChanges: [before],
      blobs: [],
      images: emptyImages(),
      metadata: null,
    });

    expect(() => replaceFigDocumentContextNodeChangesAfterTransformOnlyEdit({
      context,
      nodeChanges: [after],
      changes: [{ before, after }],
    })).toThrow(/non-transform edit/);
  });

  it("rejects source documents whose blob table is not a primary prefix", () => {
    const primaryBlob: FigBlob = { bytes: [1, 2, 3] };
    const sourceBlob: FigBlob = { bytes: [1, 2, 4] };

    expect(() => createFigDocumentContextFromNodeChanges({
      nodeChanges: [],
      blobs: [primaryBlob],
      images: emptyImages(),
      metadata: null,
      kiwiSourceDocuments: [sourceDocument([], [sourceBlob])],
    })).toThrow(/bytes differ from the primary document/);
  });
});
