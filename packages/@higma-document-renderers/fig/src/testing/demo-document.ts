/**
 * @file Renderer-owned domain fixture document
 *
 * The fixture is expressed directly as FigDesignDocument data so renderer
 * tests do not depend on document IO or fig-file builders.
 */

import type { FigDesignDocument, FigDesignNode } from "@higma-document-models/fig/domain";
import { EMPTY_FIG_STYLE_REGISTRY, toNodeId, toPageId } from "@higma-document-models/fig/domain";
import { IDENTITY_MATRIX } from "@higma-document-models/fig/matrix";
import type { FigColor, FigEffect, FigPaint } from "@higma-document-models/fig/types";

const BLUE: FigColor = { r: 0.24, g: 0.47, b: 0.85, a: 1 };
const RED: FigColor = { r: 0.9, g: 0.25, b: 0.25, a: 1 };
const GREEN: FigColor = { r: 0.22, g: 0.72, b: 0.45, a: 1 };
const ORANGE: FigColor = { r: 0.95, g: 0.55, b: 0.15, a: 1 };
const PURPLE: FigColor = { r: 0.55, g: 0.3, b: 0.85, a: 1 };
const DARK: FigColor = { r: 0.15, g: 0.15, b: 0.2, a: 1 };
const WHITE: FigColor = { r: 1, g: 1, b: 1, a: 1 };
const CANVAS_BACKGROUND: FigColor = { r: 0.9607843, g: 0.9607843, b: 0.9607843, a: 1 };

function solid(color: FigColor): FigPaint {
  return { type: "SOLID", color, opacity: 1, visible: true };
}

function linearGradient(): FigPaint {
  return {
    type: "GRADIENT_LINEAR",
    stops: [
      { position: 0, color: BLUE },
      { position: 1, color: PURPLE },
    ],
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    opacity: 1,
    visible: true,
  };
}

function radialGradient(): FigPaint {
  return {
    type: "GRADIENT_RADIAL",
    stops: [
      { position: 0, color: ORANGE },
      { position: 1, color: RED },
    ],
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    opacity: 1,
    visible: true,
  };
}

function node(
  id: string,
  type: FigDesignNode["type"],
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  extra: Partial<FigDesignNode>,
): FigDesignNode {
  return {
    id: toNodeId(id),
    type,
    name,
    visible: true,
    opacity: 1,
    transform: { ...IDENTITY_MATRIX, m02: x, m12: y },
    size: { x: width, y: height },
    fills: [],
    strokes: [],
    strokeWeight: 0,
    effects: [],
    ...extra,
  };
}

function textNode(id: string, name: string, text: string, x: number, y: number): FigDesignNode {
  const lineHeight = 24;
  return node(id, "TEXT", name, x, y, 180, 28, {
    fills: [solid(DARK)],
    textData: {
      characters: text,
      fontSize: 18,
      fontName: { family: "Inter", style: "Regular", postscript: "Inter-Regular" },
      lineHeight: { value: lineHeight, units: { name: "PIXELS", value: 0 } },
    },
    derivedTextData: {
      baselines: [{
        position: { x: 0, y: 0 },
        width: 180,
        lineY: 0,
        lineHeight,
        lineAscent: 18,
        firstCharacter: 0,
        endCharacter: text.length,
      }],
      fontMetaData: [{
        key: { family: "Inter", style: "Regular", postscript: "Inter-Regular" },
        fontLineHeight: lineHeight / 18,
        fontWeight: 400,
      }],
    },
  });
}

function innerShadow(): FigEffect {
  return {
    type: "INNER_SHADOW",
    visible: true,
    color: { r: 0, g: 0, b: 0, a: 0.25 },
    offset: { x: 0, y: 2 },
    radius: 8,
    spread: 0,
  };
}

function createShapesPage(): readonly FigDesignNode[] {
  const basicShapes = node("1:10", "FRAME", "Basic Shapes", 0, 0, 480, 320, {
    fills: [solid(WHITE)],
    strokes: [solid(DARK)],
    strokeWeight: 1,
    clipsContent: true,
    children: [
      textNode("1:11", "title", "Basic Shapes", 24, 20),
      node("1:12", "RECTANGLE", "Rectangle", 24, 68, 80, 80, {
        fills: [solid(BLUE)],
        cornerRadius: 8,
      }),
      node("1:13", "ELLIPSE", "Ellipse", 128, 68, 80, 80, {
        fills: [solid(RED)],
      }),
      node("1:14", "STAR", "Star", 232, 68, 80, 80, {
        fills: [solid(ORANGE)],
        pointCount: 5,
        starInnerScale: 0.45,
      }),
      node("1:15", "REGULAR_POLYGON", "Hexagon", 336, 68, 80, 80, {
        fills: [solid(GREEN)],
        pointCount: 6,
      }),
      node("1:16", "RECTANGLE", "Dashed Rect", 24, 200, 80, 80, {
        strokes: [solid(BLUE)],
        strokeWeight: 2,
        strokeDashes: [8, 4],
        cornerRadius: 4,
      }),
    ],
  });

  const gradients = node("1:20", "FRAME", "Gradients", 520, 0, 480, 200, {
    fills: [solid(WHITE)],
    clipsContent: true,
    children: [
      textNode("1:21", "gradient-title", "Gradient Fills", 24, 20),
      node("1:22", "RECTANGLE", "Linear Gradient", 24, 68, 120, 80, {
        fills: [linearGradient()],
        cornerRadius: 12,
      }),
      node("1:23", "ELLIPSE", "Radial Gradient", 176, 68, 120, 80, {
        fills: [radialGradient()],
      }),
    ],
  });

  return [basicShapes, gradients];
}

function createTextPage(): readonly FigDesignNode[] {
  return [
    node("2:10", "FRAME", "Typography", 0, 0, 520, 240, {
      fills: [solid(WHITE)],
      children: [
        textNode("2:11", "heading", "Renderer typography", 24, 24),
        textNode("2:12", "body", "Text layout fixture", 24, 72),
      ],
    }),
  ];
}

function createComponentPage(buttonSymbol: FigDesignNode): readonly FigDesignNode[] {
  return [
    node("3:10", "INSTANCE", "Default", 0, 0, 160, 48, {
      symbolId: buttonSymbol.id,
    }),
    node("3:11", "INSTANCE", "Danger", 0, 64, 160, 48, {
      fills: [solid(RED)],
      symbolId: buttonSymbol.id,
    }),
    node("3:12", "FRAME", "Inner Shadow Card", 0, 144, 220, 96, {
      fills: [solid(WHITE)],
      effects: [innerShadow()],
      cornerRadius: 12,
    }),
  ];
}

/**
 * Create a deterministic renderer-domain document with shapes, text, and
 * component instances.
 */
export async function createDemoFigDesignDocument(): Promise<FigDesignDocument> {
  const buttonSymbol = node("9:1", "SYMBOL", "ButtonBase", 0, 0, 160, 48, {
    fills: [solid(BLUE)],
    cornerRadius: 8,
    children: [
      node("9:2", "RECTANGLE", "button-bg", 0, 0, 160, 48, {
        fills: [solid(BLUE)],
        cornerRadius: 8,
      }),
      textNode("9:3", "button-label", "Button", 24, 12),
    ],
  });

  return {
    pages: [
      {
        id: toPageId("1:1"),
        name: "Shapes & Fills",
        backgroundColor: CANVAS_BACKGROUND,
        children: createShapesPage(),
      },
      {
        id: toPageId("2:1"),
        name: "Typography",
        backgroundColor: CANVAS_BACKGROUND,
        children: createTextPage(),
      },
      {
        id: toPageId("3:1"),
        name: "Components & Effects",
        backgroundColor: CANVAS_BACKGROUND,
        children: createComponentPage(buttonSymbol),
      },
    ],
    components: new Map([[buttonSymbol.id, buttonSymbol]]),
    images: new Map(),
    blobs: [],
    metadata: null,
    styleRegistry: EMPTY_FIG_STYLE_REGISTRY,
  };
}
