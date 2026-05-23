/** @file E2E test harness backed directly by Kiwi nodeChanges. */

import { StrictMode, useEffect, useMemo, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { injectCSSVariables } from "@higma-editor-kernel/ui/design-tokens";
import { createFigFamilyRenderOptions } from "@higma-figma-runtime/react-renderer";
import {
  createFigDocumentContextFromLoaded,
  createFigDocumentContextFromNodeChanges,
  figDocumentResources,
  type FigDocumentContext,
  type FigDocumentContextKiwiSourceDocument,
} from "@higma-document-io/fig";
import { loadFigFile } from "@higma-document-io/fig/roundtrip";
import type { FigPackageImage } from "@higma-figma-containers/package";
import { FigEditorProvider, useFigEditor } from "../../src/context/FigEditorContext";
import { FigEditorCanvas } from "../../src/canvas/FigEditorCanvas";
import { FigPageRenderer } from "../../src/canvas/rendering/FigPageRenderer";
import { flattenAllNodeBounds } from "../../src/canvas/interaction/bounds";
import { FigEditorToolbar } from "../../src/editor/FigEditorToolbar";
import { PropertyPanel } from "../../src/panels/properties/PropertyPanel";
import { PageListPanel } from "../../src/panels/pages/PageListPanel";
import { LayerPanel } from "../../src/panels/layers/LayerPanel";
import type { FigEditorRendererKind } from "../../src/canvas/rendering/renderer-kind";
import { createCachedTextFontResolver, type TextFontResolver } from "@higma-document-renderers/fig/text";
import { createBrowserFontLoader } from "@higma-document-renderers/fig/font-drivers/browser";
import type {
  AbstractFont,
  FontPath,
} from "@higma-document-models/fig/font";
import {
  collectFontQueries,
  createCachingFontLoader,
  fontQueryKey,
  preloadFonts,
  type FontQuery,
} from "@higma-document-models/fig/font";
import type {
  FigEffect,
  FigFontName,
  FigGuid,
  FigMatrix,
  FigNode,
  FigColor,
  FigDerivedTextData,
  FigPaint,
  FigValueWithUnits,
} from "@higma-document-models/fig/types";
import { readKiwiTransform } from "@higma-document-models/fig/matrix";
import {
  EFFECT_TYPE_VALUES,
  NODE_TYPE_VALUES,
  NUMBER_UNITS_VALUES,
  PAINT_TYPE_VALUES,
  SCALE_MODE_VALUES,
} from "@higma-document-models/fig/constants";
import { getNodeType, guidToString } from "@higma-document-models/fig/domain";

injectCSSVariables();

const DOCUMENT_GUID: FigGuid = { sessionID: 0, localID: 0 };
const PAGE_GUID: FigGuid = { sessionID: 0, localID: 1 };
const COMPONENT_GUID: FigGuid = { sessionID: 20, localID: 1 };
const COMPONENT_LABEL_DEF_GUID: FigGuid = { sessionID: 20, localID: 10 };
const COMPONENT_ICON_DEF_GUID: FigGuid = { sessionID: 20, localID: 11 };
const COMPONENT_ICON_VISIBLE_DEF_GUID: FigGuid = { sessionID: 20, localID: 12 };
const COMPONENT_VARIANT_DEF_GUID: FigGuid = { sessionID: 20, localID: 13 };
const ICON_A_GUID: FigGuid = { sessionID: 21, localID: 1 };
const ICON_B_GUID: FigGuid = { sessionID: 21, localID: 2 };
const COMPONENT_SET_GUID: FigGuid = { sessionID: 30, localID: 1 };
const COMPONENT_SET_PRIMARY_GUID: FigGuid = { sessionID: 30, localID: 2 };
const COMPONENT_SET_SECONDARY_GUID: FigGuid = { sessionID: 30, localID: 3 };
const COMPONENT_SET_VARIANT_DEF_GUID: FigGuid = { sessionID: 30, localID: 10 };
const TEST_IMAGE_REF = "a1b2c3d4";
const TEST_IMAGE_HASH_BYTES: readonly number[] = [0xa1, 0xb2, 0xc3, 0xd4];
const TEXT_FILL_STYLE_GUID: FigGuid = { sessionID: 40, localID: 1 };
const TEXT_FILL_STYLE_KEY = "e2e-text-fill-style";

function createTestFontPath({ x, y, fontSize }: { readonly x: number; readonly y: number; readonly fontSize: number }): FontPath {
  const width = fontSize * 0.48;
  const height = fontSize * 0.7;
  const top = y - height;
  const commands: FontPath["commands"] = [
    { type: "M", x, y: top },
    { type: "L", x: x + width, y: top },
    { type: "L", x: x + width, y },
    { type: "L", x, y },
    { type: "Z" },
  ];
  return {
    commands,
    toPathData: () => `M${x} ${top}L${x + width} ${top}L${x + width} ${y}L${x} ${y}Z`,
  };
}

const TEST_FONT: AbstractFont = {
  unitsPerEm: 1000,
  ascender: 800,
  descender: -200,
  charToGlyph: () => ({
    index: 1,
    advanceWidth: 500,
    getPath: (x, y, fontSize) => createTestFontPath({ x, y, fontSize }),
  }),
  getPath: (text, x, y, fontSize, options) => {
    const letterSpacing = options?.letterSpacing ?? 0;
    const advance = fontSize * 0.5 + letterSpacing;
    const commands = Array.from(text).flatMap((character, index): FontPath["commands"] => {
      if (character === " ") {
        return [];
      }
      return createTestFontPath({ x: x + index * advance, y, fontSize }).commands;
    });
    return {
      commands,
      toPathData: () => commands.map((command) => {
        switch (command.type) {
          case "M":
          case "L":
            return `${command.type}${command.x} ${command.y}`;
          case "Q":
            return `Q${command.x1} ${command.y1} ${command.x} ${command.y}`;
          case "C":
            return `C${command.x1} ${command.y1} ${command.x2} ${command.y2} ${command.x} ${command.y}`;
          case "Z":
            return "Z";
        }
      }).join(""),
    };
  },
};

const TEST_TEXT_FONT_RESOLVER: TextFontResolver = () => TEST_FONT;
const BROWSER_FONT_LOADER = createCachingFontLoader(createBrowserFontLoader());
const BROWSER_TEXT_FONT_RESOLVER = createCachedTextFontResolver(BROWSER_FONT_LOADER);

type FontMode = "test" | "browser-real";

type LoadedFigFile = Awaited<ReturnType<typeof loadFigFile>>;

type BrowserFontPreloadState = {
  readonly key: string;
  readonly ready: boolean;
};

type RouteContextState =
  | { readonly type: "synthetic"; readonly context: FigDocumentContext }
  | { readonly type: "loading" }
  | { readonly type: "loaded"; readonly context: FigDocumentContext }
  | { readonly type: "error"; readonly error: Error };

type HarnessRoute = {
  readonly view: "editor" | "frame";
  readonly figUrl?: string;
  readonly sourceUrls: readonly string[];
  readonly selectedGuid?: FigGuid;
  readonly activePageGuid?: FigGuid;
  readonly frameGuid?: FigGuid;
};

function resolveFontModeFromLocation(location: Location): FontMode {
  const mode = new URLSearchParams(location.search).get("fontMode");
  if (mode === "browser-real") {
    return mode;
  }
  return "test";
}

function parseRouteGuid(value: string, parameterName: string): FigGuid {
  const parts = value.split(":");
  if (parts.length !== 2) {
    throw new Error(`${parameterName} must be formatted as sessionID:localID`);
  }
  const sessionID = Number(parts[0]);
  const localID = Number(parts[1]);
  if (!Number.isInteger(sessionID) || !Number.isInteger(localID)) {
    throw new Error(`${parameterName} must contain integer sessionID and localID`);
  }
  return { sessionID, localID };
}

function parseOptionalRouteGuid(
  params: URLSearchParams,
  parameterName: string,
): FigGuid | undefined {
  const value = params.get(parameterName);
  if (value === null) {
    return undefined;
  }
  return parseRouteGuid(value, parameterName);
}

function readHarnessRoute(location: Location): HarnessRoute {
  const params = new URLSearchParams(location.search);
  const figUrl = params.get("figUrl") ?? undefined;
  return {
    view: readHarnessView(params),
    ...(figUrl === undefined ? {} : { figUrl }),
    sourceUrls: params.getAll("sourceUrl"),
    selectedGuid: parseOptionalRouteGuid(params, "selectGuid"),
    activePageGuid: parseOptionalRouteGuid(params, "activePageGuid"),
    frameGuid: parseOptionalRouteGuid(params, "frameGuid"),
  };
}

function readHarnessView(params: URLSearchParams): HarnessRoute["view"] {
  const view = params.get("view");
  if (view === null || view === "editor") {
    return "editor";
  }
  if (view === "frame") {
    return "frame";
  }
  throw new Error(`Unsupported E2E harness view: ${view}`);
}

async function readRouteFigFile(url: string): Promise<LoadedFigFile> {
  if (url.length === 0) {
    throw new Error("figUrl/sourceUrl must not be empty");
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`E2E harness failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  const buffer = await response.arrayBuffer();
  return loadFigFile(new Uint8Array(buffer));
}

function kiwiSourceDocumentFromLoaded(loaded: LoadedFigFile): FigDocumentContextKiwiSourceDocument {
  return {
    nodeChanges: loaded.nodeChanges,
    blobs: loaded.blobs,
    images: loaded.images,
  };
}

async function createRoutedContext(route: HarnessRoute): Promise<FigDocumentContext> {
  if (route.figUrl === undefined) {
    throw new Error("createRoutedContext requires figUrl");
  }
  const [primary, ...sources] = await Promise.all([
    readRouteFigFile(route.figUrl),
    ...route.sourceUrls.map(readRouteFigFile),
  ]);
  if (primary === undefined) {
    throw new Error("createRoutedContext could not load primary figUrl");
  }
  return createFigDocumentContextFromLoaded(primary, {
    kiwiSourceDocuments: sources.map(kiwiSourceDocumentFromLoaded),
  });
}

function guid(localID: number, sessionID = 1): FigGuid {
  return { sessionID, localID };
}

function position(index: number): string {
  return String.fromCharCode(0x21 + index);
}

function transform(x: number, y: number): FigMatrix {
  return { m00: 1, m01: 0, m02: x, m10: 0, m11: 1, m12: y };
}

function solid(color: FigColor): FigPaint {
  return {
    type: { value: PAINT_TYPE_VALUES.SOLID, name: "SOLID" },
    color,
    opacity: 1,
    visible: true,
  };
}

function imageFill(): FigPaint {
  return {
    type: { value: PAINT_TYPE_VALUES.IMAGE, name: "IMAGE" },
    imageScaleMode: { value: SCALE_MODE_VALUES.FILL, name: "FILL" },
    image: { hash: TEST_IMAGE_HASH_BYTES },
    opacity: 1,
    visible: true,
  };
}

const BLUE = solid({ r: 0.16, g: 0.36, b: 0.88, a: 1 });
const RED = solid({ r: 0.9, g: 0.2, b: 0.2, a: 1 });
const GREEN = solid({ r: 0.2, g: 0.65, b: 0.32, a: 1 });
const DARK = solid({ r: 0.08, g: 0.09, b: 0.12, a: 1 });
const WHITE = solid({ r: 1, g: 1, b: 1, a: 1 });

function lineHeight(value: number): FigValueWithUnits {
  return { value, units: { value: NUMBER_UNITS_VALUES.PIXELS, name: "PIXELS" } };
}

function fontName(family: string, style: string): FigFontName {
  return { family, style, postscript: `${family}-${style.replace(/\s+/g, "")}` };
}

type DerivedTextLineMetric = {
  readonly text: string;
  readonly lineIndex: number;
  readonly firstCharacter: number;
  readonly endCharacter: number;
};

type ExplicitDerivedTextLine = {
  readonly text: string;
  readonly firstCharacter: number;
  readonly endCharacter: number;
};

function lineStartOffset(segments: readonly string[], lineIndex: number): number {
  return segments
    .slice(0, lineIndex)
    .reduce((sum, segment) => sum + segment.length + 1, 0);
}

function lineEndOffset(
  segment: string,
  start: number,
  lineIndex: number,
  lineCount: number,
): number {
  if (lineIndex === lineCount - 1) {
    return start + segment.length;
  }
  return start + segment.length + 1;
}

function derivedTextLines(text: string): readonly DerivedTextLineMetric[] {
  const segments = text.split("\n");
  return segments.map((segment, lineIndex) => {
    const start = lineStartOffset(segments, lineIndex);
    return {
      text: segment,
      lineIndex,
      firstCharacter: start,
      endCharacter: lineEndOffset(segment, start, lineIndex, segments.length),
    };
  });
}

function lineTextForSourceRange(text: string, line: ExplicitDerivedTextLine): string {
  const source = text.slice(line.firstCharacter, line.endCharacter);
  if (source.endsWith("\n")) {
    return source.slice(0, -1);
  }
  return source;
}

function explicitDerivedTextLines(
  text: string,
  lines: readonly ExplicitDerivedTextLine[] | undefined,
): readonly DerivedTextLineMetric[] | undefined {
  if (lines === undefined) {
    return undefined;
  }
  return lines.map((line, lineIndex) => {
    const source = lineTextForSourceRange(text, line);
    if (source !== line.text) {
      throw new Error(`Explicit derived text line ${lineIndex} does not match its source range`);
    }
    return { ...line, lineIndex };
  });
}

function derivedTextMetrics({
  text,
  family,
  style,
  fontSize,
  textLineHeight,
  explicitLines,
}: {
  readonly text: string;
  readonly family: string;
  readonly style: string;
  readonly fontSize: number;
  readonly textLineHeight: number;
  readonly explicitLines?: readonly ExplicitDerivedTextLine[];
}): FigDerivedTextData | undefined {
  if (text.length === 0) {
    return undefined;
  }
  const lines = explicitDerivedTextLines(text, explicitLines) ?? derivedTextLines(text);
  return {
    baselines: lines.map((line) => ({
      position: { x: 0, y: line.lineIndex * textLineHeight + fontSize * 0.8 },
      width: line.text.length * fontSize * 0.5,
      lineY: line.lineIndex * textLineHeight,
      lineHeight: textLineHeight,
      lineAscent: fontSize * 0.8,
      firstCharacter: line.firstCharacter,
      endCharacter: line.endCharacter,
    })),
    fontMetaData: [{
      key: { family, style, postscript: `${family}-${style.replace(/\s+/g, "")}` },
      fontLineHeight: textLineHeight / fontSize,
      fontWeight: 400,
    }],
  };
}

function componentPropType(name: "BOOL" | "TEXT" | "NUMBER" | "INSTANCE_SWAP" | "VARIANT" | "COLOR" | "IMAGE" | "SLOT") {
  const values = {
    BOOL: 0,
    TEXT: 1,
    NUMBER: 2,
    INSTANCE_SWAP: 3,
    VARIANT: 4,
    COLOR: 5,
    IMAGE: 6,
    SLOT: 7,
  } as const;
  return { value: values[name], name };
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function createFixtureImageBytes(): Uint8Array {
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 2;
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("Could not create image fixture canvas context");
  }
  context.fillStyle = "#ff0000";
  context.fillRect(0, 0, 2, 2);
  const encoded = canvas.toDataURL("image/png").split(",")[1];
  if (encoded === undefined) {
    throw new Error("Image fixture canvas did not produce a PNG data URL");
  }
  return base64ToBytes(encoded);
}

function fixtureImage(): FigPackageImage {
  return {
    ref: TEST_IMAGE_REF,
    mimeType: "image/png",
    data: createFixtureImageBytes(),
  };
}

function documentNode(): FigNode {
  return {
    guid: DOCUMENT_GUID,
    phase: { value: 0, name: "CREATED" },
    type: { value: NODE_TYPE_VALUES.DOCUMENT, name: "DOCUMENT" },
  };
}

function canvasNode(): FigNode {
  return {
    guid: PAGE_GUID,
    parentIndex: { guid: DOCUMENT_GUID, position: position(0) },
    phase: { value: 0, name: "CREATED" },
    type: { value: NODE_TYPE_VALUES.CANVAS, name: "CANVAS" },
    name: "Page 1",
    backgroundColor: { r: 0.96, g: 0.96, b: 0.96, a: 1 },
  };
}

type NodeInput = {
  readonly localID: number;
  readonly parentGuid: FigGuid;
  readonly positionIndex: number;
  readonly type: keyof typeof NODE_TYPE_VALUES;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fills?: readonly FigPaint[];
  readonly strokes?: readonly FigPaint[];
  readonly effects?: readonly FigEffect[];
  readonly extra?: Partial<FigNode>;
};

function node(input: NodeInput): FigNode {
  return {
    guid: guid(input.localID),
    parentIndex: { guid: input.parentGuid, position: position(input.positionIndex) },
    phase: { value: 0, name: "CREATED" },
    type: { value: NODE_TYPE_VALUES[input.type], name: input.type },
    name: input.name,
    visible: true,
    opacity: 1,
    transform: transform(input.x, input.y),
    size: { x: input.width, y: input.height },
    fillPaints: input.fills,
    strokePaints: input.strokes,
    effects: input.effects,
    ...input.extra,
  };
}

function textNode({
  localID,
  parentGuid,
  positionIndex,
  text,
  x,
  y,
  width,
  height,
  family,
  explicitDerivedLines,
}: {
  readonly localID: number;
  readonly parentGuid: FigGuid;
  readonly positionIndex: number;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly family: string;
  readonly explicitDerivedLines?: readonly ExplicitDerivedTextLine[];
}): FigNode {
  const font = fontName(family, "Regular");
  const fontSize = 16;
  const textLineHeight = lineHeight(24);
  return node({
    localID,
    parentGuid,
    positionIndex,
    type: "TEXT",
    name: `Text: ${text.slice(0, 20)}`,
    x,
    y,
    width,
    height,
    fills: [DARK],
    extra: {
      fontName: font,
      fontSize,
      lineHeight: textLineHeight,
      textData: {
        characters: text,
        fontName: font,
        fontSize,
        lineHeight: textLineHeight,
      },
      derivedTextData: derivedTextMetrics({
        text,
        family,
        style: "Regular",
        fontSize,
        textLineHeight: textLineHeight.value,
        explicitLines: explicitDerivedLines,
      }),
    },
  });
}

function testEffect(): FigEffect {
  return {
    type: { value: EFFECT_TYPE_VALUES.DROP_SHADOW, name: "DROP_SHADOW" },
    visible: true,
    color: { r: 0, g: 0, b: 0, a: 0.25 },
    offset: { x: 0, y: 4 },
    radius: 8,
    spread: 0,
  };
}

function componentSymbolNode(): FigNode {
  return {
    guid: COMPONENT_GUID,
    phase: { value: 0, name: "CREATED" },
    type: { value: NODE_TYPE_VALUES.SYMBOL, name: "SYMBOL" },
    name: "Button Component",
    visible: true,
    opacity: 1,
    transform: transform(0, 0),
    size: { x: 180, y: 60 },
    fillPaints: [WHITE],
    componentPropDefs: [
      {
        id: COMPONENT_LABEL_DEF_GUID,
        name: "Label",
        type: componentPropType("TEXT"),
        initialValue: { textValue: { characters: "Default label" } },
      },
      {
        id: COMPONENT_ICON_DEF_GUID,
        name: "Icon",
        type: componentPropType("INSTANCE_SWAP"),
        initialValue: { guidValue: ICON_A_GUID },
      },
      {
        id: COMPONENT_ICON_VISIBLE_DEF_GUID,
        name: "Show icon",
        type: componentPropType("BOOL"),
        initialValue: { boolValue: true },
      },
      {
        id: COMPONENT_VARIANT_DEF_GUID,
        name: "State",
        type: componentPropType("VARIANT"),
        initialValue: { guidValue: COMPONENT_GUID },
      },
    ],
  };
}

function componentBackgroundNode(): FigNode {
  return {
    ...node({
      localID: 2,
      parentGuid: COMPONENT_GUID,
      positionIndex: 0,
      type: "ROUNDED_RECTANGLE",
      name: "Button Background",
      x: 0,
      y: 0,
      width: 180,
      height: 60,
      fills: [solid({ r: 0.92, g: 0.95, b: 1, a: 1 })],
      extra: { cornerRadius: 8 },
    }),
    guid: { sessionID: 20, localID: 2 },
  };
}

function componentLabelNode(): FigNode {
  return {
    ...textNode({
      localID: 3,
      parentGuid: COMPONENT_GUID,
      positionIndex: 1,
      text: "Default label",
      x: 48,
      y: 20,
      width: 110,
      height: 22,
      family: "Inter",
    }),
    guid: { sessionID: 20, localID: 3 },
    name: "Button Label",
    componentPropRefs: [{
      defID: COMPONENT_LABEL_DEF_GUID,
      componentPropNodeField: { value: 0, name: "TEXT_DATA" },
    }],
  };
}

function componentIconInstanceNode(): FigNode {
  return {
    ...node({
      localID: 4,
      parentGuid: COMPONENT_GUID,
      positionIndex: 2,
      type: "INSTANCE",
      name: "Button Icon",
      x: 18,
      y: 21,
      width: 18,
      height: 18,
      extra: {
        symbolData: { symbolID: ICON_A_GUID },
        componentPropRefs: [
          {
            defID: COMPONENT_ICON_DEF_GUID,
            componentPropNodeField: { value: 0, name: "OVERRIDDEN_SYMBOL_ID" },
          },
          {
            defID: COMPONENT_ICON_VISIBLE_DEF_GUID,
            componentPropNodeField: { value: 0, name: "VISIBLE" },
          },
        ],
      },
    }),
    guid: { sessionID: 20, localID: 4 },
  };
}

function iconSymbolNode(guidValue: FigGuid, name: string, fill: FigPaint): FigNode {
  return {
    guid: guidValue,
    phase: { value: 0, name: "CREATED" },
    type: { value: NODE_TYPE_VALUES.SYMBOL, name: "SYMBOL" },
    name,
    visible: true,
    opacity: 1,
    transform: transform(0, 0),
    size: { x: 18, y: 18 },
    fillPaints: [fill],
  };
}

function componentInstanceNode(page: FigGuid): FigNode {
  return node({
    localID: 18,
    parentGuid: page,
    positionIndex: 10,
    type: "INSTANCE",
    name: "Button Instance",
    x: 760,
    y: 70,
    width: 180,
    height: 60,
    extra: { symbolData: { symbolID: COMPONENT_GUID } },
  });
}

function editableSectionNode(page: FigGuid): FigNode {
  return node({
    localID: 19,
    parentGuid: page,
    positionIndex: 11,
    type: "SECTION",
    name: "Editable Section",
    x: 760,
    y: 170,
    width: 180,
    height: 90,
    fills: [solid({ r: 0.96, g: 0.91, b: 0.72, a: 1 })],
    extra: { sectionContentsHidden: false },
  });
}

function variantComponentNode(page: FigGuid): FigNode {
  return node({
    localID: 20,
    parentGuid: page,
    positionIndex: 12,
    type: "SYMBOL",
    name: "Variant Component",
    x: 960,
    y: 80,
    width: 150,
    height: 70,
    fills: [solid({ r: 0.82, g: 0.74, b: 0.96, a: 1 })],
    extra: { variantPropSpecs: [{ propDefId: COMPONENT_VARIANT_DEF_GUID, value: "Default" }] },
  });
}

function componentSetNode(page: FigGuid): FigNode {
  return {
    ...node({
      localID: COMPONENT_SET_GUID.localID,
      parentGuid: page,
      positionIndex: 13,
      type: "FRAME",
      name: "Button Variant Set",
      x: 1120,
      y: 170,
      width: 220,
      height: 90,
      fills: [solid({ r: 0.98, g: 0.98, b: 0.98, a: 1 })],
      extra: {
        isStateGroup: true,
        componentPropDefs: [{
          id: COMPONENT_SET_VARIANT_DEF_GUID,
          name: "State",
          type: componentPropType("VARIANT"),
          initialValue: { guidValue: COMPONENT_SET_PRIMARY_GUID },
        }],
      },
    }),
    guid: COMPONENT_SET_GUID,
  };
}

function componentSetVariantNode({
  guidValue,
  parentGuid,
  positionIndex,
  name,
  x,
  value,
  fill,
}: {
  readonly guidValue: FigGuid;
  readonly parentGuid: FigGuid;
  readonly positionIndex: number;
  readonly name: string;
  readonly x: number;
  readonly value: string;
  readonly fill: FigPaint;
}): FigNode {
  return {
    ...node({
      localID: guidValue.localID,
      parentGuid,
      positionIndex,
      type: "SYMBOL",
      name,
      x,
      y: 18,
      width: 90,
      height: 48,
      fills: [fill],
      extra: { variantPropSpecs: [{ propDefId: COMPONENT_SET_VARIANT_DEF_GUID, value }] },
    }),
    guid: guidValue,
  };
}

function imageFillNode(page: FigGuid): FigNode {
  return node({
    localID: 23,
    parentGuid: page,
    positionIndex: 16,
    type: "ROUNDED_RECTANGLE",
    name: "Image Fill Rect",
    x: 960,
    y: 310,
    width: 90,
    height: 70,
    fills: [imageFill()],
  });
}

function textFillStyleNode(): FigNode {
  return {
    guid: TEXT_FILL_STYLE_GUID,
    phase: { value: 0, name: "CREATED" },
    type: { value: NODE_TYPE_VALUES.RECTANGLE, name: "RECTANGLE" },
    name: "E2E Text Fill Style",
    styleType: { value: 1, name: "FILL" },
    key: TEXT_FILL_STYLE_KEY,
    fillPaints: [DARK],
  };
}

function styledTextNode(page: FigGuid): FigNode {
  return {
    ...textNode({
      localID: 24,
      parentGuid: page,
      positionIndex: 17,
      text: "Styled text",
      x: 260,
      y: 150,
      width: 220,
      height: 30,
      family: "Inter",
    }),
    styleIdForFill: { assetRef: { key: TEXT_FILL_STYLE_KEY } },
  };
}

function createSfProHarnessContext(): FigDocumentContext {
  return createFigDocumentContextFromNodeChanges({
    nodeChanges: [
      documentNode(),
      canvasNode(),
      textNode({
        localID: 50,
        parentGuid: PAGE_GUID,
        positionIndex: 0,
        text: "AAA A",
        x: 50,
        y: 420,
        width: 240,
        height: 30,
        family: "SF Pro",
      }),
    ],
    blobs: [],
    images: new Map(),
    metadata: null,
  });
}

function createHarnessContext(fontMode: FontMode): FigDocumentContext {
  if (fontMode === "browser-real") {
    return createSfProHarnessContext();
  }
  const page = PAGE_GUID;
  const nestedFrameGuid = guid(9);
  const innerFrameGuid = guid(10);
  const textFamily = "Inter";
  return createFigDocumentContextFromNodeChanges({
    nodeChanges: [
      documentNode(),
      canvasNode(),
      textNode({
        localID: 2,
        parentGuid: page,
        positionIndex: 0,
        text: "Hello World",
        x: 50,
        y: 50,
        width: 200,
        height: 30,
        family: textFamily,
      }),
      textNode({
        localID: 7,
        parentGuid: page,
        positionIndex: 1,
        text: "Line one\nLine two\nLine three",
        x: 50,
        y: 120,
        width: 250,
        height: 80,
        family: textFamily,
      }),
      textNode({
        localID: 8,
        parentGuid: page,
        positionIndex: 2,
        text: "",
        x: 50,
        y: 240,
        width: 200,
        height: 30,
        family: textFamily,
      }),
      textNode({
        localID: 16,
        parentGuid: page,
        positionIndex: 3,
        text: "Hello World",
        x: 260,
        y: 50,
        width: 60,
        height: 80,
        family: textFamily,
        explicitDerivedLines: [
          { text: "Hello ", firstCharacter: 0, endCharacter: 6 },
          { text: "World", firstCharacter: 6, endCharacter: 11 },
        ],
      }),
      node({
        localID: 3,
        parentGuid: page,
        positionIndex: 4,
        type: "ROUNDED_RECTANGLE",
        name: "Rectangle",
        x: 50,
        y: 310,
        width: 150,
        height: 80,
        fills: [BLUE],
        effects: [testEffect()],
        extra: { cornerRadius: 8 },
      }),
      node({
        localID: 4,
        parentGuid: page,
        positionIndex: 5,
        type: "ELLIPSE",
        name: "Ellipse",
        x: 130,
        y: 330,
        width: 120,
        height: 80,
        fills: [RED],
      }),
      node({
        localID: 5,
        parentGuid: page,
        positionIndex: 6,
        type: "LINE",
        name: "Line",
        x: 280,
        y: 455,
        width: 120,
        height: 40,
        strokes: [DARK],
        extra: { strokeWeight: 2 },
      }),
      node({
        localID: 6,
        parentGuid: page,
        positionIndex: 7,
        type: "VECTOR",
        name: "Vector",
        x: 330,
        y: 310,
        width: 120,
        height: 100,
        fills: [GREEN],
        extra: { vectorPaths: [{ windingRule: "NONZERO", data: "M 0 0 C 60 0 80 20 100 40 L 70 90 L 0 70 Z" }] },
      }),
      node({
        localID: 9,
        parentGuid: page,
        positionIndex: 8,
        type: "FRAME",
        name: "Nested Frame",
        x: 520,
        y: 300,
        width: 220,
        height: 150,
        fills: [WHITE],
        extra: { clipsContent: true, strokeWeight: 1, strokePaints: [DARK] },
      }),
      node({
        localID: 10,
        parentGuid: nestedFrameGuid,
        positionIndex: 0,
        type: "FRAME",
        name: "Inner Frame",
        x: 28,
        y: 22,
        width: 160,
        height: 110,
        fills: [WHITE],
        extra: { clipsContent: true },
      }),
      node({
        localID: 11,
        parentGuid: innerFrameGuid,
        positionIndex: 0,
        type: "ROUNDED_RECTANGLE",
        name: "Frame Child Rect",
        x: 34,
        y: 28,
        width: 92,
        height: 58,
        fills: [GREEN],
        extra: { cornerRadius: 6 },
      }),
      node({
        localID: 12,
        parentGuid: innerFrameGuid,
        positionIndex: 1,
        type: "VECTOR",
        name: "Frame Child Vector",
        x: 98,
        y: 18,
        width: 58,
        height: 42,
        fills: [BLUE],
        extra: { vectorPaths: [{ windingRule: "NONZERO", data: "M 0 0 C 25 0 45 12 50 24 L 32 40 L 0 30 Z" }] },
      }),
      node({
        localID: 13,
        parentGuid: page,
        positionIndex: 9,
        type: "GROUP",
        name: "Covering Group",
        x: 760,
        y: 300,
        width: 170,
        height: 120,
      }),
      node({
        localID: 14,
        parentGuid: guid(13),
        positionIndex: 0,
        type: "ROUNDED_RECTANGLE",
        name: "Group Child Rect",
        x: 24,
        y: 26,
        width: 90,
        height: 54,
        fills: [RED],
        extra: { cornerRadius: 4 },
      }),
      node({
        localID: 17,
        parentGuid: guid(13),
        positionIndex: 1,
        type: "VECTOR",
        name: "Group Child Vector",
        x: 92,
        y: 40,
        width: 52,
        height: 38,
        fills: [BLUE],
        extra: { vectorPaths: [{ windingRule: "NONZERO", data: "M 0 0 C 20 0 44 8 48 22 L 25 36 L 0 26 Z" }] },
      }),
      editableSectionNode(page),
      componentSymbolNode(),
      componentBackgroundNode(),
      componentLabelNode(),
      componentIconInstanceNode(),
      iconSymbolNode(ICON_A_GUID, "Icon A", solid({ r: 0.1, g: 0.35, b: 1, a: 1 })),
      iconSymbolNode(ICON_B_GUID, "Icon B", solid({ r: 0, g: 1, b: 0, a: 1 })),
      componentInstanceNode(page),
      variantComponentNode(page),
      componentSetNode(page),
      componentSetVariantNode({
        guidValue: COMPONENT_SET_PRIMARY_GUID,
        parentGuid: COMPONENT_SET_GUID,
        positionIndex: 0,
        name: "Primary",
        x: 12,
        value: "Default",
        fill: solid({ r: 0.78, g: 0.88, b: 1, a: 1 }),
      }),
      componentSetVariantNode({
        guidValue: COMPONENT_SET_SECONDARY_GUID,
        parentGuid: COMPONENT_SET_GUID,
        positionIndex: 1,
        name: "Secondary",
        x: 114,
        value: "Hover",
        fill: solid({ r: 0.9, g: 0.82, b: 1, a: 1 }),
      }),
      imageFillNode(page),
      textFillStyleNode(),
      styledTextNode(page),
    ],
    blobs: [],
    images: new Map([[TEST_IMAGE_REF, fixtureImage()]]),
    metadata: null,
  });
}

const containerStyle: CSSProperties = {
  width: "100vw",
  height: "100vh",
  display: "flex",
  flexDirection: "column",
};

const toolbarStyle: CSSProperties = {
  borderBottom: "1px solid #d6dee8",
};

function editorBodyStyle(panelMode: PanelMode): CSSProperties {
  if (panelMode === "none") {
    return { flex: 1, minHeight: 0, display: "grid" };
  }
  return {
    flex: 1,
    minHeight: 0,
    display: "grid",
    gridTemplateColumns: panelMode === "all" ? "240px minmax(0, 1fr) 320px" : "minmax(0, 1fr) 320px",
  };
}

const leftPanelStyle: CSSProperties = {
  minHeight: 0,
  overflow: "auto",
  borderRight: "1px solid #d6dee8",
};

const propertyPanelStyle: CSSProperties = {
  minHeight: 0,
  overflow: "auto",
  borderLeft: "1px solid #d6dee8",
};

function requiresBrowserTextFonts(mode: FontMode, renderer: FigEditorRendererKind): boolean {
  return mode === "browser-real" && (renderer === "webgl" || renderer === "svg");
}

function selectTextFontResolver(mode: FontMode, browserFontsReady: boolean): TextFontResolver | undefined {
  if (mode !== "browser-real") {
    return TEST_TEXT_FONT_RESOLVER;
  }
  if (!browserFontsReady) {
    return undefined;
  }
  return BROWSER_TEXT_FONT_RESOLVER;
}

function collectHarnessFontQueries(context: FigDocumentContext, route: HarnessRoute) {
  const resources = figDocumentResources(context);
  return collectFontQueries({
    roots: routeFrameFontPreloadRoots(context, route),
    symbolResolver: context.symbolResolver,
    childrenOf: resources.childrenOf,
  }).fontResolverQueries;
}

function collectActivePageFontQueries(context: FigDocumentContext, activePage: FigNode) {
  const resources = figDocumentResources(context);
  return collectFontQueries({
    roots: [activePage],
    symbolResolver: context.symbolResolver,
    childrenOf: resources.childrenOf,
  }).fontResolverQueries;
}

function routeFrameFontPreloadRoots(context: FigDocumentContext, route: HarnessRoute): readonly FigNode[] {
  if (route.view !== "frame") {
    throw new Error("E2E harness route frame font preload requires frame view");
  }
  return [requireRouteFrame(context, route.frameGuid)];
}

function requireRouteFrame(context: FigDocumentContext, guid: FigGuid | undefined): FigNode {
  if (guid === undefined) {
    throw new Error("E2E harness frame font preload requires frameGuid");
  }
  return requireRouteNode(context, guid, "frame font preload");
}

function requireRouteNode(context: FigDocumentContext, guid: FigGuid, owner: string): FigNode {
  const key = guidToString(guid);
  const node = context.document.nodesByGuid.get(key);
  if (node === undefined) {
    throw new Error(`E2E harness ${owner} cannot find Kiwi node ${key}`);
  }
  return node;
}

function collectResolvedDescendantNames(
  node: FigNode,
  childrenOf: (node: FigNode) => readonly FigNode[],
): readonly string[] {
  const names = node.name === undefined ? [] : [node.name];
  return [
    ...names,
    ...childrenOf(node).flatMap((child) => collectResolvedDescendantNames(child, childrenOf)),
  ];
}

function collectResolvedInstanceNames(
  node: FigNode,
  context: FigDocumentContext,
): string {
  const resolved = context.symbolResolver.resolveInstance(node);
  return [
    ...collectResolvedDescendantNames(resolved.node, context.symbolResolver.childrenOfResolvedNode),
    ...resolved.children.flatMap((child) => (
      collectResolvedDescendantNames(child, context.symbolResolver.childrenOfResolvedNode)
    )),
  ].join("|");
}

function SelectedSymbolResolutionDiagnostics({
  selectedGuid,
}: {
  readonly selectedGuid: FigGuid | undefined;
}) {
  const { activePage, context, resources } = useFigEditor();
  if (selectedGuid === undefined) {
    return null;
  }
  const selectedKey = guidToString(selectedGuid);
  const node = context.document.nodesByGuid.get(selectedKey);
  if (node === undefined) {
    throw new Error(`E2E harness selected node ${selectedKey} is not present`);
  }
  if (activePage === undefined) {
    throw new Error("E2E harness selected diagnostics require an active page");
  }
  const selectedBounds = flattenAllNodeBounds(context.document, resources.childrenOf(activePage))
    .find((bounds) => bounds.id === selectedKey);
  if (selectedBounds === undefined) {
    throw new Error(`E2E harness selected node ${selectedKey} has no editor bounds`);
  }
  const nodeType = getNodeType(node);
  const resolution = context.symbolResolver.resolveReferences(node);
  const effectiveSymbolGuid = resolvedEffectiveSymbolGuid(resolution);
  const resolvedDescendantNames = resolvedInstanceDescendantNames({
    node,
    nodeType,
    context,
    hasEffectiveSymbol: resolution.effectiveSymbol !== undefined,
  });
  return (
    <div
      hidden
      data-e2e-selected-guid={selectedKey}
      data-e2e-selected-type={nodeType}
      data-e2e-selected-x={selectedBounds.x}
      data-e2e-selected-y={selectedBounds.y}
      data-e2e-selected-width={selectedBounds.width}
      data-e2e-selected-height={selectedBounds.height}
      data-e2e-effective-symbol-guid={effectiveSymbolGuid}
      data-e2e-resolved-descendant-names={resolvedDescendantNames}
    />
  );
}

function resolvedEffectiveSymbolGuid(
  resolution: ReturnType<FigDocumentContext["symbolResolver"]["resolveReferences"]>,
): string {
  if (resolution.effectiveSymbol === undefined) {
    return "";
  }
  return guidToString(resolution.effectiveSymbol.guid);
}

function resolvedInstanceDescendantNames({
  node,
  nodeType,
  context,
  hasEffectiveSymbol,
}: {
  readonly node: FigNode;
  readonly nodeType: string;
  readonly context: FigDocumentContext;
  readonly hasEffectiveSymbol: boolean;
}): string {
  if (nodeType !== "INSTANCE" || !hasEffectiveSymbol) {
    return "";
  }
  return collectResolvedInstanceNames(node, context);
}

function useBrowserTextFontPreload({
  enabled,
  context,
  route,
}: {
  readonly enabled: boolean;
  readonly context: FigDocumentContext | undefined;
  readonly route: HarnessRoute;
}): boolean {
  const queries = useMemo(() => {
    if (!enabled || context === undefined) {
      return [];
    }
    return collectHarnessFontQueries(context, route);
  }, [context, enabled, route]);
  return useBrowserFontQueryPreload({ enabled: enabled && context !== undefined, queries });
}

function useActivePageBrowserTextFontPreload({
  enabled,
}: {
  readonly enabled: boolean;
}): boolean {
  const { activePage, context } = useFigEditor();
  const queries = useMemo(() => {
    if (!enabled) {
      return [];
    }
    if (activePage === undefined) {
      throw new Error("E2E harness active-page font preload requires an active CANVAS");
    }
    return collectActivePageFontQueries(context, activePage);
  }, [activePage, context, enabled]);
  return useBrowserFontQueryPreload({ enabled, queries });
}

function browserFontPreloadKey(queries: readonly FontQuery[]): string {
  return queries.map(fontQueryKey).join("\n");
}

function useBrowserFontQueryPreload({
  enabled,
  queries,
}: {
  readonly enabled: boolean;
  readonly queries: readonly FontQuery[];
}): boolean {
  const key = useMemo(() => browserFontPreloadKey(queries), [queries]);
  const [state, setState] = useState<BrowserFontPreloadState>(() => ({
    key,
    ready: !enabled,
  }));
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!enabled) {
      setState({ key, ready: true });
      return;
    }
    const cancelled = { value: false };
    setState({ key, ready: false });
    setError(null);
    void preloadFonts({ queries, loader: BROWSER_FONT_LOADER }).then(
      () => {
        if (!cancelled.value) {
          setState({ key, ready: true });
        }
      },
      (reason: unknown) => {
        if (cancelled.value) {
          return;
        }
        if (reason instanceof Error) {
          setError(reason);
          return;
        }
        setError(new Error(`Browser font preload failed with non-Error reason: ${String(reason)}`));
      },
    );
    return () => {
      cancelled.value = true;
    };
  }, [enabled, key, queries]);

  if (error !== null) {
    throw error;
  }
  return !enabled || (state.key === key && state.ready);
}

function useHarnessContext(fontMode: FontMode, route: HarnessRoute): RouteContextState {
  const syntheticContext = useMemo(() => createHarnessContext(fontMode), [fontMode]);
  const [state, setState] = useState<RouteContextState>(() => {
    if (route.figUrl === undefined) {
      return { type: "synthetic", context: syntheticContext };
    }
    return { type: "loading" };
  });

  useEffect(() => {
    if (route.figUrl === undefined) {
      setState({ type: "synthetic", context: syntheticContext });
      return;
    }
    const cancellation = { cancelled: false };
    setState({ type: "loading" });
    void createRoutedContext(route).then(
      (context) => {
        if (!cancellation.cancelled) {
          setState({ type: "loaded", context });
        }
      },
      (reason: unknown) => {
        if (cancellation.cancelled) {
          return;
        }
        if (reason instanceof Error) {
          setState({ type: "error", error: reason });
          return;
        }
        setState({ type: "error", error: new Error(`E2E harness route load failed: ${String(reason)}`) });
      },
    );
    return () => {
      cancellation.cancelled = true;
    };
  }, [route, syntheticContext]);

  return state;
}

function contextFromRouteState(state: RouteContextState): FigDocumentContext | undefined {
  if (state.type === "synthetic" || state.type === "loaded") {
    return state.context;
  }
  return undefined;
}

const frameOnlyContainerStyle: CSSProperties = {
  display: "block",
  backgroundColor: "transparent",
  lineHeight: 0,
};

const fontPreloadPendingStyle: CSSProperties = {
  minWidth: 0,
  minHeight: 0,
};

function FrameOnlyHarness({
  context,
  frameGuid,
  renderer,
  textFontResolver,
}: {
  readonly context: FigDocumentContext;
  readonly frameGuid: FigGuid | undefined;
  readonly renderer: FigEditorRendererKind;
  readonly textFontResolver: TextFontResolver | undefined;
}) {
  if (frameGuid === undefined) {
    throw new Error("E2E frame view requires frameGuid");
  }
  const resources = useMemo(() => figDocumentResources(context), [context]);
  const frameKey = guidToString(frameGuid);
  const frame = context.document.nodesByGuid.get(frameKey);
  if (frame === undefined) {
    throw new Error(`E2E frame view cannot find frame ${frameKey}`);
  }
  const page = findCanvasAncestor(context, frame);
  const size = frame.size;
  if (size === undefined) {
    throw new Error(`E2E frame view requires size for frame ${frameKey}`);
  }
  const transformMatrix = readKiwiTransform(frame.transform);
  return (
    <div data-e2e-frame-renderer="" style={{ ...frameOnlyContainerStyle, width: size.x, height: size.y }}>
      <FigPageRenderer
        page={page}
        nodes={[frame]}
        canvasWidth={size.x}
        canvasHeight={size.y}
        viewportX={transformMatrix.m02}
        viewportY={transformMatrix.m12}
        viewportWidth={size.x}
        viewportHeight={size.y}
        viewportScale={1}
        resources={resources}
        renderOptions={createFigFamilyRenderOptions(context)}
        renderer={renderer}
        host="html"
        textFontResolver={textFontResolver}
      />
    </div>
  );
}

function parentNode(context: FigDocumentContext, node: FigNode): FigNode | undefined {
  const parentGuid = node.parentIndex?.guid;
  if (parentGuid === undefined) {
    return undefined;
  }
  return context.document.nodesByGuid.get(guidToString(parentGuid));
}

function findCanvasAncestor(context: FigDocumentContext, node: FigNode): FigNode {
  if (getNodeType(node) === "CANVAS") {
    return node;
  }
  const parent = parentNode(context, node);
  if (parent === undefined) {
    const nodeKey = node.guid === undefined ? "(missing-guid)" : guidToString(node.guid);
    throw new Error(`E2E frame view cannot find CANVAS ancestor for ${nodeKey}`);
  }
  return findCanvasAncestor(context, parent);
}

function FrameOnlyFontGate({
  context,
  route,
  renderer,
  fontMode,
}: {
  readonly context: FigDocumentContext;
  readonly route: HarnessRoute;
  readonly renderer: FigEditorRendererKind;
  readonly fontMode: FontMode;
}) {
  const browserFontsReady = useBrowserTextFontPreload({
    enabled: requiresBrowserTextFonts(fontMode, renderer),
    context,
    route,
  });
  const textFontResolver = selectTextFontResolver(fontMode, browserFontsReady);
  if (requiresBrowserTextFonts(fontMode, renderer) && !browserFontsReady) {
    return <div data-browser-font-preload="pending" />;
  }
  return (
    <FrameOnlyHarness
      context={context}
      frameGuid={route.frameGuid}
      renderer={renderer}
      textFontResolver={textFontResolver}
    />
  );
}

function EditorHarness({
  renderer,
  panelMode,
  fontMode,
  webglInitializationDelayMs,
  selectedGuid,
}: {
  readonly renderer: FigEditorRendererKind;
  readonly panelMode: PanelMode;
  readonly fontMode: FontMode;
  readonly webglInitializationDelayMs: number | undefined;
  readonly selectedGuid: FigGuid | undefined;
}) {
  return (
    <div style={containerStyle}>
      <div style={toolbarStyle}>
        <FigEditorToolbar />
      </div>
      <div style={editorBodyStyle(panelMode)}>
        {panelMode === "all" && (
          <aside aria-label="Pages and Layers" style={leftPanelStyle}>
            <PageListPanel />
            <LayerPanel />
          </aside>
        )}
        <EditorCanvasFontAware
          renderer={renderer}
          fontMode={fontMode}
          webglInitializationDelayMs={webglInitializationDelayMs}
        />
        <SelectedSymbolResolutionDiagnostics selectedGuid={selectedGuid} />
        {(panelMode === "property" || panelMode === "all") && (
          <aside aria-label="Properties" style={propertyPanelStyle}>
            <PropertyPanel />
          </aside>
        )}
      </div>
    </div>
  );
}

function EditorCanvasFontAware({
  renderer,
  fontMode,
  webglInitializationDelayMs,
}: {
  readonly renderer: FigEditorRendererKind;
  readonly fontMode: FontMode;
  readonly webglInitializationDelayMs: number | undefined;
}) {
  const browserFontsReady = useActivePageBrowserTextFontPreload({
    enabled: requiresBrowserTextFonts(fontMode, renderer),
  });
  const textFontResolver = selectTextFontResolver(fontMode, browserFontsReady);
  if (requiresBrowserTextFonts(fontMode, renderer) && !browserFontsReady) {
    return <div data-browser-font-preload="pending" style={fontPreloadPendingStyle} />;
  }
  return (
    <FigEditorCanvas
      renderer={renderer}
      textFontResolver={textFontResolver}
      webglInitializationDelayMs={webglInitializationDelayMs}
    />
  );
}

function App() {
  const route = useMemo(() => readHarnessRoute(window.location), []);
  const renderer = resolveRendererFromLocation(window.location);
  const panelMode = resolvePanelModeFromLocation(window.location);
  const webglInitializationDelayMs = resolveWebGLInitializationDelayMsFromLocation(window.location);
  const fontMode = resolveFontModeFromLocation(window.location);
  const contextState = useHarnessContext(fontMode, route);
  if (contextState.type === "loading") {
    return <div data-e2e-harness-state="loading" />;
  }
  if (contextState.type === "error") {
    throw contextState.error;
  }
  const initialContext = contextFromRouteState(contextState);
  if (initialContext === undefined) {
    throw new Error("E2E harness reached ready state without a FigDocumentContext");
  }
  if (route.view === "frame") {
    return (
      <FrameOnlyFontGate
        context={initialContext}
        route={route}
        renderer={renderer}
        fontMode={fontMode}
      />
    );
  }
  return (
    <FigEditorProvider
      context={initialContext}
      initialActivePageGuid={route.activePageGuid}
      initialSelectedGuids={route.selectedGuid === undefined ? undefined : [route.selectedGuid]}
    >
      <EditorHarness
        renderer={renderer}
        panelMode={panelMode}
        fontMode={fontMode}
        webglInitializationDelayMs={webglInitializationDelayMs}
        selectedGuid={route.selectedGuid}
      />
    </FigEditorProvider>
  );
}

type PanelMode = "none" | "property" | "all";

function resolvePanelModeFromLocation(location: Location): PanelMode {
  const panel = new URLSearchParams(location.search).get("panel");
  if (panel === "property" || panel === "all") {
    return panel;
  }
  return "none";
}

function resolveRendererFromLocation(location: Location): FigEditorRendererKind {
  const renderer = new URLSearchParams(location.search).get("renderer");
  if (renderer === "webgl") {
    return "webgl";
  }
  return "svg";
}

function resolveWebGLInitializationDelayMsFromLocation(location: Location): number | undefined {
  const raw = new URLSearchParams(location.search).get("webglInitializationDelayMs");
  if (raw === null) {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid webglInitializationDelayMs query value: ${raw}`);
  }
  return value;
}

const root = document.getElementById("root");
if (root === null) {
  throw new Error("Root element #root not found");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
