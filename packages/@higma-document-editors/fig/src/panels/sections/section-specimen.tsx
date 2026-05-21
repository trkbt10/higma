/** @file Kiwi section specimen rendering for property-panel specs. */

import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createFigDocumentContextFromNodeChanges } from "@higma-document-io/fig";
import {
  EFFECT_TYPE_VALUES,
  NODE_TYPE_VALUES,
  NUMBER_UNITS_VALUES,
  PAINT_TYPE_VALUES,
} from "@higma-document-models/fig/constants";
import type {
  FigColor,
  FigEffect,
  FigGuid,
  FigNodeType,
  FigNode,
  FigPaint,
  FigSolidPaint,
} from "@higma-document-models/fig/types";
import { FigEditorProvider } from "../../context/FigEditorContext";

const DOCUMENT_GUID: FigGuid = { sessionID: 80, localID: 0 };
const PAGE_GUID: FigGuid = { sessionID: 80, localID: 1 };
type SectionNodeType = Extract<FigNodeType, keyof typeof NODE_TYPE_VALUES>;

export const SECTION_COLORS = {
  blue: { r: 0.2, g: 0.5, b: 0.9, a: 1 },
  red: { r: 0.9, g: 0.2, b: 0.2, a: 1 },
  dark: { r: 0.1, g: 0.1, b: 0.1, a: 1 },
} as const satisfies Readonly<Record<string, FigColor>>;

/** Return a stable test GUID. */
export function sectionGuid(localID: number): FigGuid {
  return { sessionID: 80, localID };
}

/** Return a Kiwi solid paint. */
export function sectionSolidPaint(color: FigColor): FigSolidPaint {
  return {
    type: { value: PAINT_TYPE_VALUES.SOLID, name: "SOLID" },
    color,
    opacity: 1,
    visible: true,
  };
}

/** Return a Kiwi inner-shadow effect. */
export function sectionInnerShadow(): FigEffect {
  return {
    type: { value: EFFECT_TYPE_VALUES.INNER_SHADOW, name: "INNER_SHADOW" },
    visible: true,
    color: { r: 0, g: 0, b: 0, a: 0.25 },
    offset: { x: 0, y: 2 },
    radius: 8,
  };
}

/** Return a CANVAS page for section specs. */
export function sectionPage(): FigNode {
  return sectionNode("CANVAS", {
    guid: PAGE_GUID,
    parentIndex: { guid: DOCUMENT_GUID, position: "a" },
    name: "Page",
    width: 500,
    height: 400,
  });
}

/** Return the DOCUMENT root for section specs. */
export function sectionDocument(): FigNode {
  return sectionNode("DOCUMENT", { guid: DOCUMENT_GUID, name: "Document" });
}

/** Return a Kiwi node for section specs. */
export function sectionNode(
  type: SectionNodeType,
  overrides: Partial<FigNode> & { readonly guid?: FigGuid; readonly name?: string; readonly width?: number; readonly height?: number } = {},
): FigNode {
  const guid = overrides.guid ?? sectionGuid(2);
  return {
    guid,
    phase: { value: 0, name: "PAINT" },
    type: { value: NODE_TYPE_VALUES[type], name: type },
    name: overrides.name ?? type,
    parentIndex: overrides.parentIndex,
    visible: overrides.visible ?? true,
    opacity: overrides.opacity ?? 1,
    transform: overrides.transform ?? { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    size: overrides.size ?? { x: overrides.width ?? 100, y: overrides.height ?? 50 },
    fillPaints: overrides.fillPaints,
    strokePaints: overrides.strokePaints,
    strokeWeight: overrides.strokeWeight,
    effects: overrides.effects,
    cornerRadius: overrides.cornerRadius,
    rectangleCornerRadii: overrides.rectangleCornerRadii,
    stackMode: overrides.stackMode,
    stackSpacing: overrides.stackSpacing,
    horizontalConstraint: overrides.horizontalConstraint,
    verticalConstraint: overrides.verticalConstraint,
    componentPropDefs: overrides.componentPropDefs,
    componentPropRefs: overrides.componentPropRefs,
    componentPropAssignments: overrides.componentPropAssignments,
    isStateGroup: overrides.isStateGroup,
    symbolData: overrides.symbolData,
    variantPropSpecs: overrides.variantPropSpecs,
    exportSettings: overrides.exportSettings,
    vectorPaths: overrides.vectorPaths,
    sectionContentsHidden: overrides.sectionContentsHidden,
    textData: overrides.textData,
    fontSize: overrides.fontSize,
    fontName: overrides.fontName,
  };
}

/** Render a section inside FigEditorProvider using Kiwi nodeChanges. */
export function renderSection(element: ReactElement, nodeChanges: readonly FigNode[]): string {
  const context = createFigDocumentContextFromNodeChanges({
    nodeChanges: [sectionDocument(), sectionPage(), ...nodeChanges],
    blobs: [],
    images: new Map(),
    metadata: null,
  });
  return renderToStaticMarkup(createElement(FigEditorProvider, { context, children: element }));
}

/** Return textData with explicit font fields. */
export function sectionTextData(characters: string): NonNullable<FigNode["textData"]> {
  const fontName = { family: "Inter", style: "Regular", postscript: "Inter-Regular" };
  return {
    characters,
    fontSize: 16,
    fontName,
    lineHeight: { value: 24, units: { value: NUMBER_UNITS_VALUES.PIXELS, name: "PIXELS" } },
  };
}

/** Return a single symbol and instance pair for section specs. */
export function sectionSymbolPair(): { readonly symbol: FigNode; readonly instance: FigNode } {
  const symbol = sectionNode("SYMBOL", {
    guid: sectionGuid(10),
    name: "Symbol",
    fillPaints: [sectionSolidPaint(SECTION_COLORS.blue)],
  });
  const instance = sectionNode("INSTANCE", {
    guid: sectionGuid(11),
    name: "Instance",
    symbolData: { symbolID: symbol.guid },
  });
  return { symbol, instance };
}

/** Return a single export setting payload. */
export function sectionExportSettings(): NonNullable<FigNode["exportSettings"]> {
  return [{
    constraint: { type: { value: 0, name: "SCALE" }, value: 1 },
    imageType: { value: 0, name: "PNG" },
    suffix: "",
  }];
}

/** Return a single solid-paint array. */
export function sectionPaints(color: FigColor): readonly FigPaint[] {
  return [sectionSolidPaint(color)];
}
