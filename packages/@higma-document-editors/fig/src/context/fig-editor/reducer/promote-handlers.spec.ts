/**
 * @file Phase 1 promotion action tests.
 *
 * Verifies that the new SYMBOL / INSTANCE / Variant-Set / Internal
 * Canvas / Style proxy actions:
 *  1. modify `FigDesignDocument` shape correctly, and
 *  2. round-trip through `documentToTree` with all Phase 0a load-bearing
 *     Kiwi fields emitted (isSymbolPublishable, symbolData.symbolID,
 *     frameMaskDisabled, internalOnly, styleType, etc.).
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
import type { FigNode, FigStyleId } from "@higma-document-models/fig/types";
import { documentToTree } from "@higma-document-io/fig/context";
import { createFigEditorState, figEditorReducer } from "./reducer";

function nodeId(id: string): FigNodeId {
  return id as FigNodeId;
}
function pageId(id: string): FigPageId {
  return id as FigPageId;
}

function makeShape(id: string, name: string, type: FigDesignNode["type"] = "RECTANGLE"): FigDesignNode {
  return {
    id: nodeId(id),
    type,
    name,
    visible: true,
    opacity: 1,
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    size: { x: 100, y: 50 },
    fills: [],
    strokes: [],
    strokeWeight: 0,
    effects: [],
  };
}

function makeDoc(children: readonly FigDesignNode[]): FigDesignDocument {
  return {
    pages: [{
      id: pageId("0:100"),
      name: "Page 1",
      backgroundColor: DEFAULT_PAGE_BACKGROUND,
      children,
    }],
    components: new Map(),
    images: new Map(),
    blobs: [],
    metadata: null,
    styleRegistry: EMPTY_FIG_STYLE_REGISTRY,
  };
}

function findKiwiNodeByName(nodes: readonly FigNode[], name: string): FigNode | undefined {
  return nodes.find((n) => n.name === name);
}

describe("Phase 1 — PROMOTE_TO_SYMBOL", () => {
  it("flips type to SYMBOL with isSymbolPublishable=true and registers it as a component", () => {
    const frame = makeShape("1:10", "Icon", "FRAME");
    const doc = makeDoc([frame]);
    const state = createFigEditorState(doc);

    const next = figEditorReducer(state, {
      type: "PROMOTE_TO_SYMBOL",
      nodeId: nodeId("1:10"),
      name: "IconSymbol",
    });

    const promoted = next.documentHistory.present.pages[0]!.children[0]!;
    expect(promoted.type).toBe("SYMBOL");
    expect(promoted.name).toBe("IconSymbol");
    expect(promoted.isSymbolPublishable).toBe(true);

    const components = next.documentHistory.present.components;
    expect(components.has(promoted.id)).toBe(true);

    // documentToTree must emit type.value === 15 (SYMBOL) and the
    // isSymbolPublishable flag.
    const { nodeChanges } = documentToTree(next.documentHistory.present);
    const kiwi = findKiwiNodeByName(nodeChanges, "IconSymbol");
    expect(kiwi).toBeDefined();
    expect(kiwi!.type?.value).toBe(15);
    expect(kiwi!.type?.name).toBe("SYMBOL");
    expect(kiwi!.isSymbolPublishable).toBe(true);
  });
});

describe("Phase 1 — PROMOTE_TO_INSTANCE", () => {
  it("flips type to INSTANCE pointing at the SYMBOL with symbolData populated at export time", () => {
    const symbol: FigDesignNode = {
      ...makeShape("1:1", "BaseSymbol", "SYMBOL"),
      isSymbolPublishable: true,
    };
    const carrier = makeShape("1:10", "InstanceCarrier", "FRAME");
    const doc: FigDesignDocument = {
      ...makeDoc([symbol, carrier]),
      components: new Map([[symbol.id, symbol]]),
    };
    const state = createFigEditorState(doc);

    const next = figEditorReducer(state, {
      type: "PROMOTE_TO_INSTANCE",
      nodeId: nodeId("1:10"),
      symbolId: nodeId("1:1"),
      dropChildren: true,
    });

    const instance = next.documentHistory.present.pages[0]!.children[1]!;
    expect(instance.type).toBe("INSTANCE");
    expect(instance.symbolId).toBe("1:1");
    expect(instance.children).toBeUndefined();

    const { nodeChanges } = documentToTree(next.documentHistory.present);
    const kiwi = findKiwiNodeByName(nodeChanges, "InstanceCarrier");
    expect(kiwi).toBeDefined();
    expect(kiwi!.type?.value).toBe(16);
    expect(kiwi!.type?.name).toBe("INSTANCE");
    expect(kiwi!.symbolData?.symbolID).toEqual({ sessionID: 1, localID: 1 });
    expect(kiwi!.symbolData?.uniformScaleFactor).toBe(1);
  });
});

describe("Phase 1 — CREATE_SYMBOL_WITH_INSTANCES", () => {
  it("creates a SYMBOL on the host page and flips members to INSTANCE", () => {
    const exemplar = makeShape("1:10", "Star", "STAR");
    const memberA = makeShape("1:11", "MemberA", "STAR");
    const memberB = makeShape("1:12", "MemberB", "STAR");
    const doc = makeDoc([exemplar, memberA, memberB]);
    const state = createFigEditorState(doc);

    const next = figEditorReducer(state, {
      type: "CREATE_SYMBOL_WITH_INSTANCES",
      hostPageId: pageId("0:100"),
      name: "SharedStar",
      exemplarNodeId: nodeId("1:10"),
      memberNodeIds: [nodeId("1:11"), nodeId("1:12")],
    });

    const docNext = next.documentHistory.present;
    const symbol = docNext.pages[0]!.children.find((n) => n.name === "SharedStar")!;
    expect(symbol.type).toBe("SYMBOL");
    expect(symbol.isSymbolPublishable).toBe(true);
    expect(symbol.children?.length).toBe(1);

    const a = docNext.pages[0]!.children.find((n) => n.id === ("1:11" as FigNodeId))!;
    const b = docNext.pages[0]!.children.find((n) => n.id === ("1:12" as FigNodeId))!;
    expect(a.type).toBe("INSTANCE");
    expect(a.symbolId).toBe(symbol.id);
    expect(b.type).toBe("INSTANCE");
    expect(b.symbolId).toBe(symbol.id);
  });
});

describe("Phase 1 — GROUP_AS_VARIANT_SET", () => {
  it("wraps multiple SYMBOLs in an isStateGroup FRAME with a VARIANT propDef", () => {
    const sa: FigDesignNode = {
      ...makeShape("1:1", "Size=A", "SYMBOL"),
      isSymbolPublishable: true,
    };
    const sb: FigDesignNode = {
      ...makeShape("1:2", "Size=B", "SYMBOL"),
      isSymbolPublishable: true,
    };
    const doc: FigDesignDocument = {
      ...makeDoc([sa, sb]),
      components: new Map([[sa.id, sa], [sb.id, sb]]),
    };
    const state = createFigEditorState(doc);

    const next = figEditorReducer(state, {
      type: "GROUP_AS_VARIANT_SET",
      setName: "SizeSet",
      propertyName: "Size",
      variants: [
        { symbolId: nodeId("1:1"), value: "A" },
        { symbolId: nodeId("1:2"), value: "B" },
      ],
    });

    const docNext = next.documentHistory.present;
    const setFrame = docNext.pages[0]!.children.find((n) => n.name === "SizeSet")!;
    expect(setFrame).toBeDefined();
    expect(setFrame.type).toBe("FRAME");
    expect(setFrame.isStateGroup).toBe(true);
    expect(setFrame.componentPropertyDefs?.length).toBe(1);
    expect(setFrame.componentPropertyDefs?.[0]?.type).toBe("VARIANT");
    expect(setFrame.componentPropertyDefs?.[0]?.name).toBe("Size");

    expect(setFrame.children?.length).toBe(2);
    const variantA = setFrame.children?.find((c) => c.id === ("1:1" as FigNodeId));
    const variantB = setFrame.children?.find((c) => c.id === ("1:2" as FigNodeId));
    if (!variantA || !variantB) {
      throw new Error("Variant children not found");
    }
    expect(variantA.name).toBe("Size=A");
    expect(variantB.name).toBe("Size=B");
    expect(variantA.variantPropSpecs?.[0]?.value).toBe("A");
    expect(variantB.variantPropSpecs?.[0]?.value).toBe("B");

    const { nodeChanges } = documentToTree(docNext);
    const kiwiSet = findKiwiNodeByName(nodeChanges, "SizeSet");
    expect(kiwiSet).toBeDefined();
    expect(kiwiSet!.type?.value).toBe(4);
    expect(kiwiSet!.type?.name).toBe("FRAME");
    expect(kiwiSet!.isStateGroup).toBe(true);
  });
});

describe("Phase 1 — ENSURE_INTERNAL_CANVAS", () => {
  it("creates an Internal Only Canvas page that documentToTree projects with internalOnly=true and visible=false", () => {
    const doc = makeDoc([]);
    const state = createFigEditorState(doc);

    const next = figEditorReducer(state, {
      type: "ENSURE_INTERNAL_CANVAS",
      name: "Internal Only Canvas",
    });

    const docNext = next.documentHistory.present;
    const internal = docNext.pages.find((p) => p.internalOnly === true);
    expect(internal).toBeDefined();
    expect(internal!.name).toBe("Internal Only Canvas");

    const { nodeChanges } = documentToTree(docNext);
    const kiwi = findKiwiNodeByName(nodeChanges, "Internal Only Canvas");
    expect(kiwi).toBeDefined();
    expect(kiwi!.type?.value).toBe(2);
    expect(kiwi!.type?.name).toBe("CANVAS");
    expect(kiwi!.internalOnly).toBe(true);
    expect(kiwi!.visible).toBe(false);
  });

  it("is idempotent — calling twice still leaves exactly one internal canvas", () => {
    const doc = makeDoc([]);
    const state = createFigEditorState(doc);

    const after1 = figEditorReducer(state, {
      type: "ENSURE_INTERNAL_CANVAS",
      name: "Internal Only Canvas",
    });
    const after2 = figEditorReducer(after1, {
      type: "ENSURE_INTERNAL_CANVAS",
      name: "Internal Only Canvas",
    });

    const count = after2.documentHistory.present.pages.filter((p) => p.internalOnly === true).length;
    expect(count).toBe(1);
  });
});

describe("Phase 1 — ADD_FILL_PROXY / ADD_TEXT_PROXY", () => {
  it("ADD_FILL_PROXY creates a ROUNDED_RECTANGLE with styleType FILL and a non-empty fillGeometry", () => {
    const doc = makeDoc([]);
    const s0 = createFigEditorState(doc);
    const s1 = figEditorReducer(s0, {
      type: "ENSURE_INTERNAL_CANVAS",
      name: "Internal Only Canvas",
    });
    const internalPageId = s1.documentHistory.present.pages.find((p) => p.internalOnly === true)!.id;

    const next = figEditorReducer(s1, {
      type: "ADD_FILL_PROXY",
      internalPageId,
      name: "FillProxy/Red",
      color: { r: 1, g: 0, b: 0, a: 1 },
    });

    const docNext = next.documentHistory.present;
    const internal = docNext.pages.find((p) => p.internalOnly === true)!;
    const proxy = internal.children.find((n) => n.name === "FillProxy/Red")!;
    expect(proxy).toBeDefined();
    expect(proxy.type).toBe("ROUNDED_RECTANGLE");
    expect(proxy.styleType?.name).toBe("FILL");
    expect(proxy.visible).toBe(false);
    expect(proxy.fillGeometry?.length).toBeGreaterThan(0);
    expect(proxy.fills.length).toBe(1);

    // The proxy must reference an existing blob index
    const blobIndex = proxy.fillGeometry![0]!.commandsBlob!;
    expect(docNext.blobs.length).toBeGreaterThan(blobIndex);
    expect(docNext.blobs[blobIndex]!.bytes.length).toBeGreaterThan(0);

    const { nodeChanges } = documentToTree(docNext);
    const kiwi = findKiwiNodeByName(nodeChanges, "FillProxy/Red");
    expect(kiwi).toBeDefined();
    expect(kiwi!.styleType?.name).toBe("FILL");
    expect(kiwi!.visible).toBe(false);
  });

  it("ADD_TEXT_PROXY creates a node with styleType TEXT and textData", () => {
    const doc = makeDoc([]);
    const s0 = createFigEditorState(doc);
    const s1 = figEditorReducer(s0, {
      type: "ENSURE_INTERNAL_CANVAS",
      name: "Internal Only Canvas",
    });
    const internalPageId = s1.documentHistory.present.pages.find((p) => p.internalOnly === true)!.id;

    const next = figEditorReducer(s1, {
      type: "ADD_TEXT_PROXY",
      internalPageId,
      name: "TextProxy/Body",
      fontName: { family: "Inter", style: "Regular" },
      fontSize: 16,
    });

    const docNext = next.documentHistory.present;
    const internal = docNext.pages.find((p) => p.internalOnly === true)!;
    const proxy = internal.children.find((n) => n.name === "TextProxy/Body")!;
    expect(proxy).toBeDefined();
    expect(proxy.styleType?.name).toBe("TEXT");
    expect(proxy.textData?.fontName?.family).toBe("Inter");
    expect(proxy.textData?.fontSize).toBe(16);

    const { nodeChanges } = documentToTree(docNext);
    const kiwi = findKiwiNodeByName(nodeChanges, "TextProxy/Body");
    expect(kiwi).toBeDefined();
    expect(kiwi!.styleType?.name).toBe("TEXT");
  });
});

describe("Phase 1 — BIND_FILL_STYLE / BIND_TEXT_STYLE", () => {
  const styleIdFill: FigStyleId = { sessionID: 1, localID: 50, key: "fillkey" };
  const styleIdText: FigStyleId = { sessionID: 1, localID: 60, key: "textkey" };

  it("BIND_FILL_STYLE sets styleIdForFill on the targeted node", () => {
    const node = makeShape("1:10", "Card", "FRAME");
    const doc = makeDoc([node]);
    const state = createFigEditorState(doc);

    const next = figEditorReducer(state, {
      type: "BIND_FILL_STYLE",
      nodeId: nodeId("1:10"),
      styleId: styleIdFill,
    });

    const updated = next.documentHistory.present.pages[0]!.children[0]!;
    expect(updated.styleIdForFill).toEqual(styleIdFill);
  });

  it("BIND_TEXT_STYLE sets styleIdForText on the targeted node", () => {
    const node = makeShape("1:10", "Heading", "TEXT");
    const doc = makeDoc([node]);
    const state = createFigEditorState(doc);

    const next = figEditorReducer(state, {
      type: "BIND_TEXT_STYLE",
      nodeId: nodeId("1:10"),
      styleId: styleIdText,
    });

    const updated = next.documentHistory.present.pages[0]!.children[0]!;
    expect(updated.styleIdForText).toEqual(styleIdText);
  });
});
