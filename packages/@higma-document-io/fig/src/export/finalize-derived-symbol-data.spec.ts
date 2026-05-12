/**
 * @file Spec for finalizeDerivedSymbolData — the exportFig pre-pass
 * that materialises `derivedSymbolData` on every INSTANCE whose size
 * diverges from its linked SYMBOL.
 */

import type {
  FigDesignDocument,
  FigDesignNode,
  FigNodeId,
  FigPageId,
} from "@higma-document-models/fig/domain";
import {
  DEFAULT_PAGE_BACKGROUND,
  EMPTY_FIG_STYLE_REGISTRY,
} from "@higma-document-models/fig/domain";
import { finalizeDerivedSymbolData } from "./finalize-derived-symbol-data";

function nodeId(id: string): FigNodeId {
  return id as FigNodeId;
}
function pageId(id: string): FigPageId {
  return id as FigPageId;
}

const IDENTITY = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };

function makeSymbol(id: string, w: number, h: number, child?: FigDesignNode): FigDesignNode {
  return {
    id: nodeId(id),
    type: "SYMBOL",
    name: `Symbol_${id}`,
    visible: true,
    opacity: 1,
    transform: IDENTITY,
    size: { x: w, y: h },
    fills: [],
    strokes: [],
    strokeWeight: 0,
    effects: [],
    isSymbolPublishable: true,
    children: child ? [child] : undefined,
  };
}

function makeInstance(id: string, symbolId: string, w: number, h: number): FigDesignNode {
  return {
    id: nodeId(id),
    type: "INSTANCE",
    name: `Inst_${id}`,
    visible: true,
    opacity: 1,
    transform: IDENTITY,
    size: { x: w, y: h },
    fills: [],
    strokes: [],
    strokeWeight: 0,
    effects: [],
    symbolId: nodeId(symbolId),
  };
}

function makeRect(id: string, w: number, h: number): FigDesignNode {
  return {
    id: nodeId(id),
    type: "RECTANGLE",
    name: `Rect_${id}`,
    visible: true,
    opacity: 1,
    transform: IDENTITY,
    size: { x: w, y: h },
    fills: [],
    strokes: [],
    strokeWeight: 0,
    effects: [],
    layoutConstraints: {
      horizontalConstraint: { value: 4, name: "SCALE" },
      verticalConstraint: { value: 4, name: "SCALE" },
    },
  };
}

function makeDoc(symbol: FigDesignNode, instance: FigDesignNode): FigDesignDocument {
  return {
    pages: [{
      id: pageId("0:100"),
      name: "Page 1",
      backgroundColor: DEFAULT_PAGE_BACKGROUND,
      children: [symbol, instance],
    }],
    components: new Map([[symbol.id, symbol]]),
    images: new Map(),
    blobs: [],
    metadata: null,
    styleRegistry: EMPTY_FIG_STYLE_REGISTRY,
  };
}

describe("finalizeDerivedSymbolData", () => {
  it("leaves derivedSymbolData undefined when instance size equals symbol size", () => {
    const rect = makeRect("1:2", 100, 100);
    const symbol = makeSymbol("1:1", 100, 100, rect);
    const instance = makeInstance("2:1", "1:1", 100, 100);

    const doc = makeDoc(symbol, instance);
    const finalised = finalizeDerivedSymbolData(doc);

    const finalisedInst = finalised.pages[0]!.children[1]!;
    expect(finalisedInst.derivedSymbolData).toBeUndefined();
  });

  it("populates derivedSymbolData when instance is resized", () => {
    const rect = makeRect("1:2", 100, 100);
    const symbol = makeSymbol("1:1", 100, 100, rect);
    const instance = makeInstance("2:1", "1:1", 200, 100);

    const doc = makeDoc(symbol, instance);
    const finalised = finalizeDerivedSymbolData(doc);

    const finalisedInst = finalised.pages[0]!.children[1]!;
    expect(finalisedInst.derivedSymbolData).toBeDefined();
    expect(finalisedInst.derivedSymbolData!.length).toBeGreaterThan(0);
  });

  it("does not touch nodes that are not INSTANCEs", () => {
    const rect = makeRect("1:2", 100, 100);
    const symbol = makeSymbol("1:1", 100, 100, rect);
    const otherRect = makeRect("3:1", 50, 50);

    const doc: FigDesignDocument = {
      pages: [{
        id: pageId("0:100"),
        name: "Page 1",
        backgroundColor: DEFAULT_PAGE_BACKGROUND,
        children: [symbol, otherRect],
      }],
      components: new Map([[symbol.id, symbol]]),
      images: new Map(),
      blobs: [],
      metadata: null,
      styleRegistry: EMPTY_FIG_STYLE_REGISTRY,
    };
    const finalised = finalizeDerivedSymbolData(doc);

    // SYMBOL and RECTANGLE are untouched.
    expect(finalised.pages[0]!.children[0]).toBe(doc.pages[0]!.children[0]);
    expect(finalised.pages[0]!.children[1]).toBe(doc.pages[0]!.children[1]);
  });

  it("ignores INSTANCEs whose symbolId is not in the components map", () => {
    const dangling = makeInstance("2:1", "9:9", 200, 100);
    const doc: FigDesignDocument = {
      pages: [{
        id: pageId("0:100"),
        name: "Page 1",
        backgroundColor: DEFAULT_PAGE_BACKGROUND,
        children: [dangling],
      }],
      components: new Map(),
      images: new Map(),
      blobs: [],
      metadata: null,
      styleRegistry: EMPTY_FIG_STYLE_REGISTRY,
    };
    const finalised = finalizeDerivedSymbolData(doc);

    expect(finalised.pages[0]!.children[0]!.derivedSymbolData).toBeUndefined();
  });
});
