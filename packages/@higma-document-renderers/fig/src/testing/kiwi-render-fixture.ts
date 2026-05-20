/** @file Kiwi FigNode fixture for renderer regression specs. */

import { indexFigKiwiDocument, type FigBlob, type FigKiwiDocumentIndex } from "@higma-document-models/fig/domain";
import {
  createSymbolResolver,
  buildFigStyleRegistry,
} from "@higma-document-models/fig/symbols";
import {
  EFFECT_TYPE_VALUES,
  NODE_TYPE_VALUES,
  PAINT_TYPE_VALUES,
} from "@higma-document-models/fig/constants";
import type {
  FigColor,
  FigEffect,
  FigGuid,
  FigMatrix,
  FigNode,
  FigNodeType,
  FigPaint,
  FigSolidPaint,
  KiwiEnumValue,
} from "@higma-document-models/fig/types";
import type { FigPackageImage } from "@higma-figma-containers/package";
import type { FigDocumentResources } from "@higma-document-io/fig";

export const KIWI_RENDER_COLORS = {
  blue: { r: 0.24, g: 0.47, b: 0.85, a: 1 },
  red: { r: 0.9, g: 0.25, b: 0.25, a: 1 },
  green: { r: 0.22, g: 0.72, b: 0.45, a: 1 },
  orange: { r: 0.95, g: 0.55, b: 0.15, a: 1 },
  purple: { r: 0.55, g: 0.3, b: 0.85, a: 1 },
  dark: { r: 0.15, g: 0.15, b: 0.2, a: 1 },
  white: { r: 1, g: 1, b: 1, a: 1 },
} as const satisfies Readonly<Record<string, FigColor>>;

const PHASE_PAINT: KiwiEnumValue = { value: 0, name: "PAINT" };
const IDENTITY_MATRIX: FigMatrix = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };

type KiwiNodeSpecimen = {
  readonly guid: FigGuid;
  readonly type: FixtureNodeType;
  readonly name: string;
  readonly parentGuid?: FigGuid;
  readonly position?: string;
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly visible?: boolean;
  readonly fillPaints?: readonly FigPaint[];
  readonly backgroundPaints?: readonly FigPaint[];
  readonly strokePaints?: readonly FigPaint[];
  readonly strokeWeight?: FigNode["strokeWeight"];
  readonly cornerRadius?: number;
  readonly mask?: boolean;
  readonly clipsContent?: boolean;
  readonly frameMaskDisabled?: boolean;
  readonly effects?: readonly FigEffect[];
  readonly pointCount?: number;
  readonly starInnerScale?: number;
  readonly symbolData?: FigNode["symbolData"];
  readonly vectorPaths?: FigNode["vectorPaths"];
  readonly stackMode?: FigNode["stackMode"];
  readonly stackChildAlignSelf?: FigNode["stackChildAlignSelf"];
};

type FixtureNodeType = Extract<FigNodeType, keyof typeof NODE_TYPE_VALUES>;

export type KiwiRenderFixture = {
  readonly document: FigKiwiDocumentIndex;
  readonly resources: FigDocumentResources;
  readonly pages: {
    readonly shapes: FigNode;
    readonly components: FigNode;
  };
  readonly nodes: {
    readonly basicShapesFrame: FigNode;
    readonly innerShadowCard: FigNode;
    readonly buttonSymbol: FigNode;
    readonly defaultButton: FigNode;
    readonly dangerButton: FigNode;
  };
};

/** Construct a Kiwi GUID tuple. */
export function kiwiGuid(sessionID: number, localID: number): FigGuid {
  return { sessionID, localID };
}

function enumValue<T extends string>(name: T, values: Readonly<Record<T, number>>): KiwiEnumValue<T> {
  return { value: values[name], name };
}

function nodeTypeValue(name: FixtureNodeType): KiwiEnumValue<FigNodeType> {
  return { value: NODE_TYPE_VALUES[name], name };
}

/** Construct a Kiwi solid paint. */
export function kiwiSolidPaint(color: FigColor): FigSolidPaint {
  return {
    type: enumValue("SOLID", PAINT_TYPE_VALUES),
    color,
    opacity: 1,
    visible: true,
  };
}

/** Construct a Kiwi inner-shadow effect. */
export function kiwiInnerShadow(): FigEffect {
  return {
    type: enumValue("INNER_SHADOW", EFFECT_TYPE_VALUES),
    visible: true,
    color: { r: 0, g: 0, b: 0, a: 0.25 },
    offset: { x: 0, y: 2 },
    radius: 8,
    spread: 0,
  };
}

function transformAt(x: number, y: number): FigMatrix {
  return { ...IDENTITY_MATRIX, m02: x, m12: y };
}

function parentIndexFor(specimen: KiwiNodeSpecimen): FigNode["parentIndex"] {
  if (specimen.parentGuid === undefined) {
    return undefined;
  }
  return { guid: specimen.parentGuid, position: specimen.position ?? "0" };
}

/** Construct a Kiwi FigNode specimen. */
export function kiwiNode(specimen: KiwiNodeSpecimen): FigNode {
  return {
    guid: specimen.guid,
    phase: PHASE_PAINT,
    type: nodeTypeValue(specimen.type),
    name: specimen.name,
    parentIndex: parentIndexFor(specimen),
    visible: specimen.visible ?? true,
    opacity: 1,
    transform: transformAt(specimen.x ?? 0, specimen.y ?? 0),
    size: { x: specimen.width ?? 100, y: specimen.height ?? 50 },
    fillPaints: specimen.fillPaints,
    backgroundPaints: specimen.backgroundPaints,
    strokePaints: specimen.strokePaints,
    strokeWeight: specimen.strokeWeight,
    cornerRadius: specimen.cornerRadius,
    mask: specimen.mask,
    clipsContent: specimen.clipsContent,
    frameMaskDisabled: specimen.frameMaskDisabled,
    effects: specimen.effects,
    pointCount: specimen.pointCount,
    starInnerScale: specimen.starInnerScale,
    symbolData: specimen.symbolData,
    vectorPaths: specimen.vectorPaths,
    stackMode: specimen.stackMode,
    stackChildAlignSelf: specimen.stackChildAlignSelf,
  };
}

/** Build renderer resources from a Kiwi nodeChanges array. */
export function kiwiRenderResources(
  nodeChanges: readonly FigNode[],
  blobs: readonly FigBlob[] = [],
  images: ReadonlyMap<string, FigPackageImage> = new Map(),
): FigDocumentResources {
  const document = indexFigKiwiDocument(nodeChanges);
  const styleRegistry = buildFigStyleRegistry(document);
  return {
    document,
    childrenOf: document.childrenOf,
    symbolResolver: createSymbolResolver({ document }),
    styleRegistry,
    blobs,
    images,
  };
}

/** Construct a renderer fixture covering frames, shapes, effects, and instances. */
export function createKiwiRenderFixture(): KiwiRenderFixture {
  const shapesPage = kiwiNode({
    guid: kiwiGuid(1, 1),
    type: "CANVAS",
    name: "Shapes & Fills",
    width: 1200,
    height: 800,
  });
  const componentsPage = kiwiNode({
    guid: kiwiGuid(3, 1),
    type: "CANVAS",
    name: "Components & Effects",
    width: 1200,
    height: 800,
  });
  const basicShapesFrame = kiwiNode({
    guid: kiwiGuid(1, 10),
    type: "FRAME",
    name: "Basic Shapes",
    parentGuid: shapesPage.guid,
    position: "a",
    width: 480,
    height: 320,
    fillPaints: [kiwiSolidPaint(KIWI_RENDER_COLORS.white)],
    strokePaints: [kiwiSolidPaint(KIWI_RENDER_COLORS.dark)],
    strokeWeight: 1,
    clipsContent: true,
  });
  const rectangle = kiwiNode({
    guid: kiwiGuid(1, 12),
    type: "RECTANGLE",
    name: "Rectangle",
    parentGuid: basicShapesFrame.guid,
    position: "a",
    x: 24,
    y: 68,
    width: 80,
    height: 80,
    cornerRadius: 8,
    fillPaints: [kiwiSolidPaint(KIWI_RENDER_COLORS.blue)],
  });
  const ellipse = kiwiNode({
    guid: kiwiGuid(1, 13),
    type: "ELLIPSE",
    name: "Ellipse",
    parentGuid: basicShapesFrame.guid,
    position: "b",
    x: 128,
    y: 68,
    width: 80,
    height: 80,
    fillPaints: [kiwiSolidPaint(KIWI_RENDER_COLORS.red)],
  });
  const star = kiwiNode({
    guid: kiwiGuid(1, 14),
    type: "STAR",
    name: "Star",
    parentGuid: basicShapesFrame.guid,
    position: "c",
    x: 232,
    y: 68,
    width: 80,
    height: 80,
    pointCount: 5,
    starInnerScale: 0.45,
    fillPaints: [kiwiSolidPaint(KIWI_RENDER_COLORS.orange)],
  });
  const polygon = kiwiNode({
    guid: kiwiGuid(1, 15),
    type: "REGULAR_POLYGON",
    name: "Hexagon",
    parentGuid: basicShapesFrame.guid,
    position: "d",
    x: 336,
    y: 68,
    width: 80,
    height: 80,
    pointCount: 6,
    fillPaints: [kiwiSolidPaint(KIWI_RENDER_COLORS.green)],
  });
  const buttonSymbol = kiwiNode({
    guid: kiwiGuid(9, 1),
    type: "SYMBOL",
    name: "ButtonBase",
    parentGuid: componentsPage.guid,
    position: "a",
    visible: false,
    width: 160,
    height: 48,
    cornerRadius: 8,
    fillPaints: [kiwiSolidPaint(KIWI_RENDER_COLORS.blue)],
  });
  const buttonBackground = kiwiNode({
    guid: kiwiGuid(9, 2),
    type: "RECTANGLE",
    name: "button-bg",
    parentGuid: buttonSymbol.guid,
    position: "a",
    width: 160,
    height: 48,
    cornerRadius: 8,
    fillPaints: [kiwiSolidPaint(KIWI_RENDER_COLORS.blue)],
  });
  const defaultButton = kiwiNode({
    guid: kiwiGuid(3, 10),
    type: "INSTANCE",
    name: "Default",
    parentGuid: componentsPage.guid,
    position: "b",
    width: 160,
    height: 48,
    symbolData: { symbolID: buttonSymbol.guid },
  });
  const dangerButton = kiwiNode({
    guid: kiwiGuid(3, 11),
    type: "INSTANCE",
    name: "Danger",
    parentGuid: componentsPage.guid,
    position: "c",
    y: 64,
    width: 160,
    height: 48,
    fillPaints: [kiwiSolidPaint(KIWI_RENDER_COLORS.red)],
    symbolData: { symbolID: buttonSymbol.guid },
  });
  const innerShadowCard = kiwiNode({
    guid: kiwiGuid(3, 12),
    type: "FRAME",
    name: "Inner Shadow Card",
    parentGuid: componentsPage.guid,
    position: "d",
    y: 144,
    width: 220,
    height: 96,
    cornerRadius: 12,
    fillPaints: [kiwiSolidPaint(KIWI_RENDER_COLORS.white)],
    effects: [kiwiInnerShadow()],
  });
  const nodeChanges = [
    shapesPage,
    basicShapesFrame,
    rectangle,
    ellipse,
    star,
    polygon,
    componentsPage,
    buttonSymbol,
    buttonBackground,
    defaultButton,
    dangerButton,
    innerShadowCard,
  ];
  const resources = kiwiRenderResources(nodeChanges);
  return {
    document: resources.document,
    resources,
    pages: {
      shapes: shapesPage,
      components: componentsPage,
    },
    nodes: {
      basicShapesFrame,
      innerShadowCard,
      buttonSymbol,
      defaultButton,
      dangerButton,
    },
  };
}
