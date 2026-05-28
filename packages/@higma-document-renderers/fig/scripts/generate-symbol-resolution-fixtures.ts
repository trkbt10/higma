#!/usr/bin/env bun
/**
 * @file Generate symbol-resolution fixture .fig file
 *
 * Realistic, multi-canvas fixtures that test symbol (component) resolution
 * through deep nesting, frame-level rounding/clipping, property inheritance,
 * and real-world UI component patterns.
 *
 * Canvas 1 — "Components":   UI component patterns (buttons, cards, nav bars)
 * Canvas 2 — "Clipping":     Frame-level rounding and clip behavior
 * Canvas 3 — "Deep Nesting": 5-level nesting and inheritance chains
 * Canvas 4 — "Constraints":  Constraint resolution
 * Canvas 5 — "Variants":     Variant/overriddenSymbolID support
 *
 * Usage:
 *   bun packages/@higma-document-renderers/fig/scripts/generate-symbol-resolution-fixtures.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  addNode,
  addPage,
  createEmptyFigDocument,
  exportFig,
  updateNode,
  requireCanvas,
  type FigDocumentContext,
  type KiwiChildLayoutFields,
  type SolidPaintSpec,
  type PaintSpec,
  type EffectSpec,
} from "@higma-document-io/fig";
import { createFigBuilderState } from "@higma-document-models/fig/builder";
import type { FigBuilderState } from "@higma-document-models/fig/builder";
import type { FigGuid } from "@higma-document-models/fig/types";

import type {
  FigColor,
} from "@higma-document-models/fig/types";
import {
  CONSTRAINT_TYPE_VALUES,
  type ConstraintType,
} from "@higma-document-models/fig/constants";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "../fixtures/symbol-resolution");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "symbol-resolution.fig");

// =============================================================================
// Colors (iOS-inspired palette)
// =============================================================================

const WHITE: FigColor = { r: 1, g: 1, b: 1, a: 1 };
const BLACK: FigColor = { r: 0, g: 0, b: 0, a: 1 };
const IOS_BLUE: FigColor = { r: 0, g: 0.478, b: 1, a: 1 };
const IOS_RED: FigColor = { r: 1, g: 0.231, b: 0.188, a: 1 };
const IOS_GREEN: FigColor = { r: 0.204, g: 0.78, b: 0.349, a: 1 };
const IOS_ORANGE: FigColor = { r: 1, g: 0.584, b: 0, a: 1 };
const IOS_PURPLE: FigColor = { r: 0.686, g: 0.322, b: 0.871, a: 1 };
const IOS_GRAY_BG: FigColor = { r: 0.949, g: 0.949, b: 0.969, a: 1 };
const IOS_GRAY_2: FigColor = { r: 0.682, g: 0.682, b: 0.698, a: 1 };
const IOS_GRAY_3: FigColor = { r: 0.78, g: 0.78, b: 0.8, a: 1 };
const CARD_SHADOW: FigColor = { r: 0, g: 0, b: 0, a: 0.15 };
const DARK_BG: FigColor = { r: 0.11, g: 0.11, b: 0.118, a: 1 };

// =============================================================================
// Shared construction
// =============================================================================

function solidPaint(color: FigColor, opacity = 1): SolidPaintSpec {
  return { type: "SOLID", color, opacity, visible: true };
}

function dropShadow(offsetX: number, offsetY: number, radius: number, color: FigColor): EffectSpec {
  return {
    type: "DROP_SHADOW",
    visible: true,
    color,
    offset: { x: offsetX, y: offsetY },
    radius,
  };
}

function constraintsFor(h: ConstraintType, v: ConstraintType): KiwiChildLayoutFields {
  return {
    horizontalConstraint: { value: CONSTRAINT_TYPE_VALUES[h], name: h },
    verticalConstraint: { value: CONSTRAINT_TYPE_VALUES[v], name: v },
  };
}

type Ctx = {
  readonly state: FigBuilderState;
};

type AddedNode = { readonly context: FigDocumentContext; readonly id: FigGuid };

type SymbolOpts = {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly background?: FigColor;
  readonly cornerRadius?: number;
  readonly clipsContent?: boolean;
};

function applyOptionalCornerRadius(
  context: FigDocumentContext,
  nodeGuid: FigGuid,
  cornerRadius: number | undefined,
): FigDocumentContext {
  if (cornerRadius === undefined) {return context;}
  return updateNode({ context, nodeGuid, update: (n) => ({ ...n, cornerRadius }) });
}

function applyOptionalOverrideSymbolId(
  context: FigDocumentContext,
  nodeGuid: FigGuid,
  overrideSymbolId: FigGuid | undefined,
): FigDocumentContext {
  if (overrideSymbolId === undefined) {return context;}
  return updateNode({ context, nodeGuid, update: (n) => ({ ...n, overriddenSymbolID: overrideSymbolId }) });
}

function addSymbol(
  context: FigDocumentContext,
  ctx: Ctx,
  pageGuid: FigGuid,
  opts: SymbolOpts,
): AddedNode {
  const r = addNode({
    state: ctx.state,
    context,
    pageGuid,
    parentGuid: null,
    spec: {
      visible: true,
      opacity: 1,
      type: "SYMBOL",
      name: opts.name,
      x: opts.x,
      y: opts.y,
      width: opts.width,
      height: opts.height,
      fills: opts.background ? [solidPaint(opts.background)] : [],
      clipsContent: opts.clipsContent,
    },
  });
  const contextWithRadius = applyOptionalCornerRadius(r.context, r.nodeGuid, opts.cornerRadius);
  return { context: contextWithRadius, id: r.nodeGuid };
}

type FrameOpts = {
  readonly parentGuid: FigGuid | null;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly background?: FigColor;
  readonly cornerRadius?: number;
  readonly clipsContent?: boolean;
};

function addFrame(
  context: FigDocumentContext,
  ctx: Ctx,
  pageGuid: FigGuid,
  opts: FrameOpts,
): AddedNode {
  const r = addNode({
    state: ctx.state,
    context,
    pageGuid,
    parentGuid: opts.parentGuid,
    spec: {
      visible: true,
      opacity: 1,
      type: "FRAME",
      name: opts.name,
      x: opts.x,
      y: opts.y,
      width: opts.width,
      height: opts.height,
      fills: opts.background ? [solidPaint(opts.background)] : [],
      cornerRadius: opts.cornerRadius,
      clipsContent: opts.clipsContent,
    },
  });
  return { context: r.context, id: r.nodeGuid };
}

type RoundedOpts = {
  readonly parentGuid: FigGuid;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fill?: PaintSpec;
  readonly fills?: readonly PaintSpec[];
  readonly stroke?: FigColor;
  readonly strokeWeight?: number;
  readonly cornerRadius?: number;
  readonly opacity?: number;
  readonly effects?: readonly EffectSpec[];
  readonly constraints?: KiwiChildLayoutFields;
};

function addRoundedRect(context: FigDocumentContext, ctx: Ctx, pageGuid: FigGuid, opts: RoundedOpts): AddedNode {
  const r = addNode({
    state: ctx.state,
    context,
    pageGuid,
    parentGuid: opts.parentGuid,
    spec: {
      visible: true,
      type: "ROUNDED_RECTANGLE",
      name: opts.name,
      x: opts.x,
      y: opts.y,
      width: opts.width,
      height: opts.height,
      fills: opts.fills ?? (opts.fill ? [opts.fill] : undefined),
      strokes: opts.stroke ? [solidPaint(opts.stroke)] : undefined,
      strokeWeight: opts.strokeWeight,
      cornerRadius: opts.cornerRadius,
      opacity: opts.opacity ?? 1,
      effects: opts.effects,
      ...opts.constraints,
    },
  });
  return { context: r.context, id: r.nodeGuid };
}

type EllipseOpts = {
  readonly parentGuid: FigGuid;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fill?: FigColor;
  readonly constraints?: KiwiChildLayoutFields;
};

function addEllipse(context: FigDocumentContext, ctx: Ctx, pageGuid: FigGuid, opts: EllipseOpts): AddedNode {
  const r = addNode({
    state: ctx.state,
    context,
    pageGuid,
    parentGuid: opts.parentGuid,
    spec: {
      visible: true,
      opacity: 1,
      type: "ELLIPSE",
      name: opts.name,
      x: opts.x,
      y: opts.y,
      width: opts.width,
      height: opts.height,
      fills: opts.fill ? [solidPaint(opts.fill)] : undefined,
      ...opts.constraints,
    },
  });
  return { context: r.context, id: r.nodeGuid };
}

type InstanceOpts = {
  readonly parentGuid: FigGuid;
  readonly name: string;
  readonly symbolId: FigGuid;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly background?: FigColor;
  readonly opacity?: number;
  readonly overrideSymbolId?: FigGuid;
  readonly constraints?: KiwiChildLayoutFields;
};

function addInstance(context: FigDocumentContext, ctx: Ctx, pageGuid: FigGuid, opts: InstanceOpts): AddedNode {
  const r = addNode({
    state: ctx.state,
    context,
    pageGuid,
    parentGuid: opts.parentGuid,
    spec: {
      visible: true,
      type: "INSTANCE",
      name: opts.name,
      symbolId: opts.symbolId,
      x: opts.x,
      y: opts.y,
      width: opts.width,
      height: opts.height,
      fills: opts.background ? [solidPaint(opts.background)] : undefined,
      opacity: opts.opacity ?? 1,
      ...opts.constraints,
    },
  });
  // Variant override is a Kiwi node field outside NodeSpec.
  const contextWithOverride = applyOptionalOverrideSymbolId(r.context, r.nodeGuid, opts.overrideSymbolId);
  return { context: contextWithOverride, id: r.nodeGuid };
}

// =============================================================================
// Main builder
// =============================================================================

async function generate(): Promise<void> {
  console.log("Generating symbol-resolution fixtures (realistic multi-canvas)...\n");

  const empty = createEmptyFigDocument("Components");
  const state = createFigBuilderState({
    nodeGuidCounter: { sessionID: 1, nextLocalID: 100 },
    pageGuidCounter: { sessionID: 0, nextLocalID: 2 },
  });
  const ctx: Ctx = { state };
  const page1 = requireCanvas(empty.document, "Components").guid;

  // Page 2: Clipping
  const r1 = addPage({ state, context: empty, name: "Clipping" });
  const page2 = r1.pageGuid;
  // Page 3: Deep Nesting
  const r2 = addPage({ state, context: r1.context, name: "Deep Nesting" });
  const page3 = r2.pageGuid;
  // Page 4: Constraints
  const r3 = addPage({ state, context: r2.context, name: "Constraints" });
  const page4 = r3.pageGuid;
  // Page 5: Variants
  const r4 = addPage({ state, context: r3.context, name: "Variants" });
  const page5 = r4.pageGuid;
  // Internal Only Canvas
  const r5 = addPage({ state, context: r4.context, name: "Internal Only Canvas", internalOnly: true });

  // ===========================================================================
  // Canvas 1: Components
  // ===========================================================================
  // Symbols
  const iconCircle = addSymbol(r5.context, ctx, page1, {
    name: "IconCircle", x: 0, y: -600, width: 24, height: 24, clipsContent: true,
  });
  const iconCircleBg = addEllipse(iconCircle.context, ctx, page1, {
    parentGuid: iconCircle.id,
    name: "icon-bg", x: 0, y: 0, width: 24, height: 24,
    fill: IOS_BLUE,
    constraints: constraintsFor("STRETCH", "STRETCH"),
  });

  const badge = addSymbol(iconCircleBg.context, ctx, page1, {
    name: "Badge", x: 100, y: -600, width: 18, height: 18, background: IOS_RED, cornerRadius: 9, clipsContent: true,
  });
  const badgeDot = addEllipse(badge.context, ctx, page1, {
    parentGuid: badge.id,
    name: "dot", x: 6, y: 6, width: 6, height: 6,
    fill: WHITE,
    constraints: constraintsFor("CENTER", "CENTER"),
  });

  const iconBadge = addSymbol(badgeDot.context, ctx, page1, {
    name: "IconWithBadge", x: 200, y: -600, width: 32, height: 32, clipsContent: false,
  });
  const ibIcon = addInstance(iconBadge.context, ctx, page1, {
    parentGuid: iconBadge.id, name: "icon", symbolId: iconCircle.id,
    x: 4, y: 8, width: 24, height: 24,
    constraints: constraintsFor("STRETCH", "STRETCH"),
  });
  const ibBadge = addInstance(ibIcon.context, ctx, page1, {
    parentGuid: iconBadge.id, name: "badge", symbolId: badge.id,
    x: 18, y: -4, width: 18, height: 18,
    constraints: constraintsFor("MAX", "MIN"),
  });

  const buttonBase = addSymbol(ibBadge.context, ctx, page1, {
    name: "ButtonBase", x: 350, y: -600, width: 120, height: 44, background: IOS_BLUE, cornerRadius: 12, clipsContent: true,
  });
  const btnLabel = addRoundedRect(buttonBase.context, ctx, page1, {
    parentGuid: buttonBase.id, name: "label-bg",
    x: 10, y: 8, width: 100, height: 28,
    fill: solidPaint(WHITE, 0.15),
    cornerRadius: 6,
    constraints: constraintsFor("STRETCH", "STRETCH"),
  });

  const cardHeader = addSymbol(btnLabel.context, ctx, page1, {
    name: "CardHeader", x: 550, y: -600, width: 280, height: 48, background: IOS_BLUE, clipsContent: true,
  });
  const headerStripe = addRoundedRect(cardHeader.context, ctx, page1, {
    parentGuid: cardHeader.id, name: "stripe",
    x: 0, y: 44, width: 280, height: 4,
    fill: solidPaint(BLACK, 0.1),
    constraints: constraintsFor("STRETCH", "MAX"),
  });

  const cardBody = addSymbol(headerStripe.context, ctx, page1, {
    name: "CardBody", x: 900, y: -600, width: 280, height: 120, background: WHITE, clipsContent: true,
  });
  const bodyRect1 = addRoundedRect(cardBody.context, ctx, page1, {
    parentGuid: cardBody.id, name: "content-1",
    x: 16, y: 16, width: 120, height: 80,
    fill: solidPaint(IOS_GRAY_BG),
    cornerRadius: 8,
    constraints: constraintsFor("MIN", "STRETCH"),
  });
  const bodyRect2 = addRoundedRect(bodyRect1.context, ctx, page1, {
    parentGuid: cardBody.id, name: "content-2",
    x: 144, y: 16, width: 120, height: 80,
    fill: solidPaint(IOS_GRAY_BG),
    cornerRadius: 8,
    constraints: constraintsFor("MAX", "STRETCH"),
  });

  const card = addSymbol(bodyRect2.context, ctx, page1, {
    name: "Card", x: 1250, y: -600, width: 280, height: 200, background: WHITE, cornerRadius: 16, clipsContent: true,
  });
  const cardHeaderInst = addInstance(card.context, ctx, page1, {
    parentGuid: card.id, name: "header", symbolId: cardHeader.id,
    x: 0, y: 0, width: 280, height: 48,
    constraints: constraintsFor("STRETCH", "MIN"),
  });
  const cardBodyInst = addInstance(cardHeaderInst.context, ctx, page1, {
    parentGuid: card.id, name: "body", symbolId: cardBody.id,
    x: 0, y: 48, width: 280, height: 120,
    constraints: constraintsFor("STRETCH", "STRETCH"),
  });
  const cardFooter = addRoundedRect(cardBodyInst.context, ctx, page1, {
    parentGuid: card.id, name: "footer",
    x: 0, y: 168, width: 280, height: 32,
    fill: solidPaint(IOS_GRAY_BG),
    constraints: constraintsFor("STRETCH", "MAX"),
  });

  const navItem = addSymbol(cardFooter.context, ctx, page1, {
    name: "NavItem", x: 1600, y: -600, width: 48, height: 56, clipsContent: false,
  });
  const navIcon = addInstance(navItem.context, ctx, page1, {
    parentGuid: navItem.id, name: "icon-badge", symbolId: iconBadge.id,
    x: 8, y: 4, width: 32, height: 32,
    constraints: constraintsFor("CENTER", "MIN"),
  });
  const navLabel = addRoundedRect(navIcon.context, ctx, page1, {
    parentGuid: navItem.id, name: "label-placeholder",
    x: 4, y: 42, width: 40, height: 10,
    fill: solidPaint(IOS_GRAY_2),
    cornerRadius: 2,
    constraints: constraintsFor("STRETCH", "MAX"),
  });

  const navBar = addSymbol(navLabel.context, ctx, page1, {
    name: "NavBar", x: 1800, y: -600, width: 320, height: 64, background: DARK_BG, cornerRadius: 0, clipsContent: true,
  });
  const navConstraints: readonly { h: ConstraintType; v: ConstraintType }[] = [
    { h: "MIN", v: "STRETCH" },
    { h: "SCALE", v: "STRETCH" },
    { h: "SCALE", v: "STRETCH" },
    { h: "MAX", v: "STRETCH" },
  ];
  const navBarWithItems = navConstraints.reduce<FigDocumentContext>((acc, c, i) => {
    return addInstance(acc, ctx, page1, {
      parentGuid: navBar.id, name: `nav-${i}`, symbolId: navItem.id,
      x: 24 + i * 72, y: 4, width: 48, height: 56,
      constraints: constraintsFor(c.h, c.v),
    }).context;
  }, navBar.context);
  const navSep = addRoundedRect(navBarWithItems, ctx, page1, {
    parentGuid: navBar.id, name: "separator",
    x: 0, y: 0, width: 320, height: 1,
    fill: solidPaint(IOS_GRAY_3, 0.5),
    constraints: constraintsFor("STRETCH", "MIN"),
  });

  // Canvas 1 test frames
  type TestFrame = (acc: { context: FigDocumentContext; x: number; y: number }) => FigDocumentContext;
  const canvas1Tests: readonly TestFrame[] = [
    // 1. button-inherit
    ({ context, x, y }) => {
      const f = addFrame(context, ctx, page1, { parentGuid: null, name: "button-inherit", x, y, width: 140, height: 64, background: WHITE, clipsContent: true });
      return addInstance(f.context, ctx, page1, { parentGuid: f.id, name: "ButtonBase", symbolId: buttonBase.id, x: 10, y: 10, width: 120, height: 44 }).context;
    },
    // 2. button-override
    ({ context, x, y }) => {
      const f = addFrame(context, ctx, page1, { parentGuid: null, name: "button-override", x, y, width: 280, height: 64, background: WHITE, clipsContent: true });
      const i1 = addInstance(f.context, ctx, page1, { parentGuid: f.id, name: "original", symbolId: buttonBase.id, x: 10, y: 10, width: 120, height: 44 });
      return addInstance(i1.context, ctx, page1, {
        parentGuid: f.id, name: "green-override", symbolId: buttonBase.id,
        x: 150, y: 10, width: 120, height: 44, background: IOS_GREEN,
      }).context;
    },
    // 3. card-with-header
    ({ context, x, y }) => {
      const f = addFrame(context, ctx, page1, { parentGuid: null, name: "card-with-header", x, y, width: 300, height: 220, background: IOS_GRAY_BG, clipsContent: true });
      return addInstance(f.context, ctx, page1, { parentGuid: f.id, name: "Card", symbolId: card.id, x: 10, y: 10, width: 280, height: 200 }).context;
    },
    // 4. card-resized
    ({ context, x, y }) => {
      const f = addFrame(context, ctx, page1, { parentGuid: null, name: "card-resized", x, y, width: 260, height: 180, background: IOS_GRAY_BG, clipsContent: true });
      return addInstance(f.context, ctx, page1, { parentGuid: f.id, name: "Card-small", symbolId: card.id, x: 10, y: 10, width: 240, height: 160 }).context;
    },
    // 5. icon-badge-nesting
    ({ context, x, y }) => {
      const f = addFrame(context, ctx, page1, { parentGuid: null, name: "icon-badge-nesting", x, y, width: 52, height: 52, background: WHITE, clipsContent: false });
      return addInstance(f.context, ctx, page1, { parentGuid: f.id, name: "IconWithBadge", symbolId: iconBadge.id, x: 10, y: 10, width: 32, height: 32 }).context;
    },
    // 6. navbar-full
    ({ context, x, y }) => {
      const f = addFrame(context, ctx, page1, { parentGuid: null, name: "navbar-full", x, y, width: 340, height: 84, background: IOS_GRAY_BG, clipsContent: true });
      return addInstance(f.context, ctx, page1, { parentGuid: f.id, name: "NavBar", symbolId: navBar.id, x: 10, y: 10, width: 320, height: 64 }).context;
    },
    // 7. navbar-resized
    ({ context, x, y }) => {
      const f = addFrame(context, ctx, page1, { parentGuid: null, name: "navbar-resized", x, y, width: 420, height: 84, background: IOS_GRAY_BG, clipsContent: true });
      return addInstance(f.context, ctx, page1, { parentGuid: f.id, name: "NavBar-wide", symbolId: navBar.id, x: 10, y: 10, width: 400, height: 64 }).context;
    },
    // 8. multi-button-sizes
    ({ context, x, y }) => {
      const f = addFrame(context, ctx, page1, { parentGuid: null, name: "multi-button-sizes", x, y, width: 400, height: 80, background: WHITE, clipsContent: true });
      const i1 = addInstance(f.context, ctx, page1, { parentGuid: f.id, name: "small", symbolId: buttonBase.id, x: 10, y: 24, width: 80, height: 32 });
      const i2 = addInstance(i1.context, ctx, page1, { parentGuid: f.id, name: "medium", symbolId: buttonBase.id, x: 100, y: 18, width: 120, height: 44 });
      return addInstance(i2.context, ctx, page1, { parentGuid: f.id, name: "large", symbolId: buttonBase.id, x: 230, y: 12, width: 180, height: 56 }).context;
    },
  ];

  // Canvas 1 layout: row 1 has frames 1-3, row 2 has 4-7, row 3 has 8
  const canvas1Layout: readonly { readonly x: number; readonly y: number }[] = [
    { x: 50, y: 50 }, { x: 220, y: 50 }, { x: 530, y: 50 },
    { x: 50, y: 300 }, { x: 340, y: 300 }, { x: 420, y: 300 }, { x: 790, y: 300 },
    { x: 50, y: 420 },
  ];
  const contextAfterCanvas1 = canvas1Tests.reduce<FigDocumentContext>((acc, fn, i) => {
    return fn({ context: acc, x: canvas1Layout[i].x, y: canvas1Layout[i].y });
  }, navSep.context);

  // ===========================================================================
  // Canvas 2: Clipping
  // ===========================================================================
  const avatarFrame = addSymbol(contextAfterCanvas1, ctx, page2, {
    name: "AvatarFrame", x: 0, y: -600, width: 64, height: 64, background: IOS_GRAY_3, cornerRadius: 32, clipsContent: true,
  });
  const avatarImage = addRoundedRect(avatarFrame.context, ctx, page2, {
    parentGuid: avatarFrame.id, name: "avatar-image",
    x: -8, y: -8, width: 80, height: 80,
    fill: solidPaint(IOS_PURPLE),
    constraints: constraintsFor("SCALE", "SCALE"),
  });
  const avatarAccent = addEllipse(avatarImage.context, ctx, page2, {
    parentGuid: avatarFrame.id, name: "accent",
    x: 22, y: 22, width: 20, height: 20,
    fill: IOS_ORANGE,
    constraints: constraintsFor("CENTER", "CENTER"),
  });

  const roundedContainer = addSymbol(avatarAccent.context, ctx, page2, {
    name: "RoundedContainer", x: 200, y: -600, width: 200, height: 120, background: IOS_GRAY_BG, cornerRadius: 16, clipsContent: true,
  });
  const rcOverflow = addRoundedRect(roundedContainer.context, ctx, page2, {
    parentGuid: roundedContainer.id, name: "overflow-child",
    x: 60, y: 40, width: 160, height: 100,
    fill: solidPaint(IOS_RED),
    cornerRadius: 8,
    constraints: constraintsFor("MIN", "MIN"),
  });
  const rcCorner = addRoundedRect(rcOverflow.context, ctx, page2, {
    parentGuid: roundedContainer.id, name: "corner-child",
    x: 12, y: 12, width: 80, height: 60,
    fill: solidPaint(IOS_BLUE),
    cornerRadius: 8,
    constraints: constraintsFor("MIN", "MIN"),
  });

  const nestedOuter = addSymbol(rcCorner.context, ctx, page2, {
    name: "NestedRoundedOuter", x: 500, y: -600, width: 240, height: 160, background: WHITE, cornerRadius: 20, clipsContent: true,
  });
  const nroInst = addInstance(nestedOuter.context, ctx, page2, {
    parentGuid: nestedOuter.id, name: "inner-container", symbolId: roundedContainer.id,
    x: 20, y: 20, width: 200, height: 120,
    constraints: constraintsFor("STRETCH", "STRETCH"),
  });

  const clipChain = addSymbol(nroInst.context, ctx, page2, {
    name: "ClipChain", x: 800, y: -600, width: 280, height: 180, background: DARK_BG, cornerRadius: 12, clipsContent: true,
  });
  const ccInst = addInstance(clipChain.context, ctx, page2, {
    parentGuid: clipChain.id, name: "nested-outer", symbolId: nestedOuter.id,
    x: 20, y: 10, width: 240, height: 160,
    constraints: constraintsFor("STRETCH", "STRETCH"),
  });

  const mixedClip = addSymbol(ccInst.context, ctx, page2, {
    name: "MixedClipFrame", x: 1150, y: -600, width: 200, height: 140, background: WHITE, cornerRadius: 24, clipsContent: true,
  });
  const mixedCorners: readonly { name: string; x: number; y: number; w: number; h: number; fill: FigColor; h_cons: ConstraintType; v_cons: ConstraintType }[] = [
    { name: "top-left", x: 0, y: 0, w: 60, h: 40, fill: IOS_RED, h_cons: "MIN", v_cons: "MIN" },
    { name: "top-right", x: 140, y: 0, w: 60, h: 40, fill: IOS_GREEN, h_cons: "MAX", v_cons: "MIN" },
    { name: "bottom-left", x: 0, y: 100, w: 60, h: 40, fill: IOS_BLUE, h_cons: "MIN", v_cons: "MAX" },
    { name: "bottom-right", x: 140, y: 100, w: 60, h: 40, fill: IOS_ORANGE, h_cons: "MAX", v_cons: "MAX" },
  ];
  const mixedAfterCorners = mixedCorners.reduce<FigDocumentContext>((acc, c) => {
    return addRoundedRect(acc, ctx, page2, {
      parentGuid: mixedClip.id, name: c.name,
      x: c.x, y: c.y, width: c.w, height: c.h,
      fill: solidPaint(c.fill),
      constraints: constraintsFor(c.h_cons, c.v_cons),
    }).context;
  }, mixedClip.context);
  const mcCenter = addEllipse(mixedAfterCorners, ctx, page2, {
    parentGuid: mixedClip.id, name: "center",
    x: 60, y: 40, width: 80, height: 60,
    fill: IOS_PURPLE,
    constraints: constraintsFor("CENTER", "CENTER"),
  });

  // Canvas 2 test frames
  const canvas2Tests: readonly TestFrame[] = [
    // 9. avatar-clip
    ({ context, x, y }) => {
      const f = addFrame(context, ctx, page2, { parentGuid: null, name: "avatar-clip", x, y, width: 84, height: 84, background: WHITE, clipsContent: true });
      return addInstance(f.context, ctx, page2, { parentGuid: f.id, name: "AvatarFrame", symbolId: avatarFrame.id, x: 10, y: 10, width: 64, height: 64 }).context;
    },
    // 10. avatar-small
    ({ context, x, y }) => {
      const f = addFrame(context, ctx, page2, { parentGuid: null, name: "avatar-small", x, y, width: 60, height: 60, background: WHITE, clipsContent: true });
      return addInstance(f.context, ctx, page2, { parentGuid: f.id, name: "AvatarFrame-sm", symbolId: avatarFrame.id, x: 10, y: 10, width: 40, height: 40 }).context;
    },
    // 11. rounded-container-clip
    ({ context, x, y }) => {
      const f = addFrame(context, ctx, page2, { parentGuid: null, name: "rounded-container-clip", x, y, width: 220, height: 140, background: WHITE, clipsContent: true });
      return addInstance(f.context, ctx, page2, { parentGuid: f.id, name: "RoundedContainer", symbolId: roundedContainer.id, x: 10, y: 10, width: 200, height: 120 }).context;
    },
    // 12. mixed-clip-corners
    ({ context, x, y }) => {
      const f = addFrame(context, ctx, page2, { parentGuid: null, name: "mixed-clip-corners", x, y, width: 220, height: 160, background: IOS_GRAY_BG, clipsContent: true });
      return addInstance(f.context, ctx, page2, { parentGuid: f.id, name: "MixedClipFrame", symbolId: mixedClip.id, x: 10, y: 10, width: 200, height: 140 }).context;
    },
    // 13. nested-rounded-clip
    ({ context, x, y }) => {
      const f = addFrame(context, ctx, page2, { parentGuid: null, name: "nested-rounded-clip", x, y, width: 260, height: 180, background: WHITE, clipsContent: true });
      return addInstance(f.context, ctx, page2, { parentGuid: f.id, name: "NestedRoundedOuter", symbolId: nestedOuter.id, x: 10, y: 10, width: 240, height: 160 }).context;
    },
    // 14. clip-chain-3level
    ({ context, x, y }) => {
      const f = addFrame(context, ctx, page2, { parentGuid: null, name: "clip-chain-3level", x, y, width: 300, height: 200, background: WHITE, clipsContent: true });
      return addInstance(f.context, ctx, page2, { parentGuid: f.id, name: "ClipChain", symbolId: clipChain.id, x: 10, y: 10, width: 280, height: 180 }).context;
    },
    // 15. clip-chain-resized
    ({ context, x, y }) => {
      const f = addFrame(context, ctx, page2, { parentGuid: null, name: "clip-chain-resized", x, y, width: 240, height: 160, background: WHITE, clipsContent: true });
      return addInstance(f.context, ctx, page2, { parentGuid: f.id, name: "ClipChain-sm", symbolId: clipChain.id, x: 10, y: 10, width: 220, height: 140 }).context;
    },
    // 16. avatar-row
    ({ context, x, y }) => {
      const f = addFrame(context, ctx, page2, { parentGuid: null, name: "avatar-row", x, y, width: 260, height: 84, background: WHITE, clipsContent: true });
      return [0, 1, 2].reduce<FigDocumentContext>((acc, i) => {
        return addInstance(acc, ctx, page2, { parentGuid: f.id, name: `avatar-${i}`, symbolId: avatarFrame.id, x: 10 + i * 84, y: 10, width: 64, height: 64 }).context;
      }, f.context);
    },
  ];
  const canvas2Layout: readonly { readonly x: number; readonly y: number }[] = [
    { x: 50, y: 50 }, { x: 170, y: 50 }, { x: 260, y: 50 }, { x: 510, y: 50 },
    { x: 50, y: 250 }, { x: 340, y: 250 }, { x: 670, y: 250 },
    { x: 50, y: 480 },
  ];
  const contextAfterCanvas2 = canvas2Tests.reduce<FigDocumentContext>(
    (acc, fn, i) => fn({ context: acc, x: canvas2Layout[i].x, y: canvas2Layout[i].y }),
    mcCenter.context,
  );

  // ===========================================================================
  // Canvas 3: Deep Nesting
  // ===========================================================================
  const level1 = addSymbol(contextAfterCanvas2, ctx, page3, {
    name: "L1-BaseElement", x: 0, y: -600, width: 80, height: 48, background: IOS_BLUE, cornerRadius: 8, clipsContent: true,
  });
  const l1Inner = addRoundedRect(level1.context, ctx, page3, {
    parentGuid: level1.id, name: "highlight",
    x: 10, y: 10, width: 60, height: 28,
    fill: solidPaint(WHITE, 0.3),
    cornerRadius: 4,
    constraints: constraintsFor("STRETCH", "STRETCH"),
  });

  const level2 = addSymbol(l1Inner.context, ctx, page3, {
    name: "L2-Pair", x: 200, y: -600, width: 180, height: 68, background: IOS_GRAY_BG, cornerRadius: 12, clipsContent: true,
  });
  const l2Left = addInstance(level2.context, ctx, page3, {
    parentGuid: level2.id, name: "left", symbolId: level1.id,
    x: 10, y: 10, width: 80, height: 48,
    constraints: constraintsFor("MIN", "STRETCH"),
  });
  const l2Right = addInstance(l2Left.context, ctx, page3, {
    parentGuid: level2.id, name: "right", symbolId: level1.id,
    x: 90, y: 10, width: 80, height: 48,
    background: IOS_GREEN,
    constraints: constraintsFor("MAX", "STRETCH"),
  });

  const level3 = addSymbol(l2Right.context, ctx, page3, {
    name: "L3-Decorated", x: 500, y: -600, width: 220, height: 108, background: WHITE, cornerRadius: 16, clipsContent: true,
  });
  const l3Pair = addInstance(level3.context, ctx, page3, {
    parentGuid: level3.id, name: "pair", symbolId: level2.id,
    x: 20, y: 10, width: 180, height: 68,
    constraints: constraintsFor("STRETCH", "MIN"),
  });
  const l3Bar = addRoundedRect(l3Pair.context, ctx, page3, {
    parentGuid: level3.id, name: "bar",
    x: 20, y: 86, width: 180, height: 8,
    fill: solidPaint(IOS_ORANGE),
    cornerRadius: 4,
    constraints: constraintsFor("STRETCH", "MAX"),
  });

  const level4 = addSymbol(l3Bar.context, ctx, page3, {
    name: "L4-WithBadge", x: 800, y: -600, width: 260, height: 140, background: IOS_GRAY_BG, cornerRadius: 20, clipsContent: true,
  });
  const l4Dec = addInstance(level4.context, ctx, page3, {
    parentGuid: level4.id, name: "decorated", symbolId: level3.id,
    x: 20, y: 16, width: 220, height: 108,
    constraints: constraintsFor("STRETCH", "STRETCH"),
  });
  const l4Badge = addInstance(l4Dec.context, ctx, page3, {
    parentGuid: level4.id, name: "badge", symbolId: badge.id,
    x: 234, y: 8, width: 18, height: 18,
    constraints: constraintsFor("MAX", "MIN"),
  });

  const level5 = addSymbol(l4Badge.context, ctx, page3, {
    name: "L5-Complete", x: 1150, y: -600, width: 300, height: 180, background: WHITE, cornerRadius: 24, clipsContent: true,
  });
  const l5Inner = addInstance(level5.context, ctx, page3, {
    parentGuid: level5.id, name: "with-badge", symbolId: level4.id,
    x: 20, y: 20, width: 260, height: 140,
    constraints: constraintsFor("STRETCH", "STRETCH"),
  });
  const l5Shadow = addRoundedRect(l5Inner.context, ctx, page3, {
    parentGuid: level5.id, name: "shadow-indicator",
    x: 10, y: 14, width: 280, height: 160,
    stroke: IOS_GRAY_3,
    strokeWeight: 1,
    cornerRadius: 22,
    constraints: constraintsFor("STRETCH", "STRETCH"),
  });

  const crossCanvas = addSymbol(l5Shadow.context, ctx, page3, {
    name: "CrossCanvas", x: 1500, y: -600, width: 160, height: 100, background: WHITE, cornerRadius: 12, clipsContent: true,
  });
  const ccElement = addInstance(crossCanvas.context, ctx, page3, {
    parentGuid: crossCanvas.id, name: "element", symbolId: level1.id,
    x: 10, y: 26, width: 80, height: 48,
    constraints: constraintsFor("MIN", "CENTER"),
  });
  const ccButton = addInstance(ccElement.context, ctx, page3, {
    parentGuid: crossCanvas.id, name: "button", symbolId: buttonBase.id,
    x: 92, y: 34, width: 60, height: 32,
    constraints: constraintsFor("MAX", "CENTER"),
  });

  // Canvas 3 test frames
  const canvas3Tests: readonly TestFrame[] = [
    // 17. depth-2
    ({ context, x, y }) => {
      const f = addFrame(context, ctx, page3, { parentGuid: null, name: "depth-2", x, y, width: 200, height: 88, background: WHITE, clipsContent: true });
      return addInstance(f.context, ctx, page3, { parentGuid: f.id, name: "L2-Pair", symbolId: level2.id, x: 10, y: 10, width: 180, height: 68 }).context;
    },
    // 18. depth-3
    ({ context, x, y }) => {
      const f = addFrame(context, ctx, page3, { parentGuid: null, name: "depth-3", x, y, width: 240, height: 128, background: WHITE, clipsContent: true });
      return addInstance(f.context, ctx, page3, { parentGuid: f.id, name: "L3-Decorated", symbolId: level3.id, x: 10, y: 10, width: 220, height: 108 }).context;
    },
    // 19. depth-4
    ({ context, x, y }) => {
      const f = addFrame(context, ctx, page3, { parentGuid: null, name: "depth-4", x, y, width: 280, height: 160, background: WHITE, clipsContent: true });
      return addInstance(f.context, ctx, page3, { parentGuid: f.id, name: "L4-WithBadge", symbolId: level4.id, x: 10, y: 10, width: 260, height: 140 }).context;
    },
    // 20. depth-5
    ({ context, x, y }) => {
      const f = addFrame(context, ctx, page3, { parentGuid: null, name: "depth-5", x, y, width: 320, height: 200, background: IOS_GRAY_BG, clipsContent: true });
      return addInstance(f.context, ctx, page3, { parentGuid: f.id, name: "L5-Complete", symbolId: level5.id, x: 10, y: 10, width: 300, height: 180 }).context;
    },
    // 21. depth-5-resized
    ({ context, x, y }) => {
      const f = addFrame(context, ctx, page3, { parentGuid: null, name: "depth-5-resized", x, y, width: 260, height: 160, background: IOS_GRAY_BG, clipsContent: true });
      return addInstance(f.context, ctx, page3, { parentGuid: f.id, name: "L5-small", symbolId: level5.id, x: 10, y: 10, width: 240, height: 140 }).context;
    },
    // 22. cross-canvas-ref
    ({ context, x, y }) => {
      const f = addFrame(context, ctx, page3, { parentGuid: null, name: "cross-canvas-ref", x, y, width: 180, height: 120, background: WHITE, clipsContent: true });
      return addInstance(f.context, ctx, page3, { parentGuid: f.id, name: "CrossCanvas", symbolId: crossCanvas.id, x: 10, y: 10, width: 160, height: 100 }).context;
    },
    // 23. depth-override
    ({ context, x, y }) => {
      const f = addFrame(context, ctx, page3, { parentGuid: null, name: "depth-override", x, y, width: 280, height: 160, background: WHITE, clipsContent: true });
      return addInstance(f.context, ctx, page3, {
        parentGuid: f.id, name: "L4-overridden", symbolId: level4.id,
        x: 10, y: 10, width: 260, height: 140, background: IOS_PURPLE,
      }).context;
    },
    // 24. multi-depth-mixed
    ({ context, x, y }) => {
      const f = addFrame(context, ctx, page3, { parentGuid: null, name: "multi-depth-mixed", x, y, width: 380, height: 200, background: IOS_GRAY_BG, clipsContent: true });
      const i1 = addInstance(f.context, ctx, page3, { parentGuid: f.id, name: "L1", symbolId: level1.id, x: 10, y: 76, width: 80, height: 48 });
      const i2 = addInstance(i1.context, ctx, page3, { parentGuid: f.id, name: "L2", symbolId: level2.id, x: 100, y: 74, width: 140, height: 52 });
      const i3 = addInstance(i2.context, ctx, page3, { parentGuid: f.id, name: "L3", symbolId: level3.id, x: 250, y: 71, width: 120, height: 58 });
      return addInstance(i3.context, ctx, page3, { parentGuid: f.id, name: "L4", symbolId: level4.id, x: 10, y: 136, width: 360, height: 60 }).context;
    },
  ];

  const canvas3Layout: readonly { readonly x: number; readonly y: number }[] = [
    { x: 50, y: 50 }, { x: 280, y: 50 }, { x: 550, y: 50 },
    { x: 50, y: 240 }, { x: 400, y: 240 }, { x: 680, y: 240 },
    { x: 50, y: 470 }, { x: 360, y: 470 },
  ];
  const contextAfterCanvas3Tests = canvas3Tests.reduce<FigDocumentContext>(
    (acc, fn, i) => fn({ context: acc, x: canvas3Layout[i].x, y: canvas3Layout[i].y }),
    ccButton.context,
  );

  // Effect-inherit and opacity-chain — extra symbols for canvas 3
  const effectBox = addSymbol(contextAfterCanvas3Tests, ctx, page3, {
    name: "EffectBox", x: 1800, y: -600, width: 120, height: 80, background: WHITE, cornerRadius: 12, clipsContent: true,
  });
  const effectChild = addRoundedRect(effectBox.context, ctx, page3, {
    parentGuid: effectBox.id, name: "inner",
    x: 10, y: 10, width: 100, height: 60,
    fill: solidPaint(IOS_BLUE),
    cornerRadius: 8,
    effects: [dropShadow(0, 4, 8, CARD_SHADOW)],
    constraints: constraintsFor("STRETCH", "STRETCH"),
  });

  // 25. effect-inherit
  const fEffect = addFrame(effectChild.context, ctx, page3, {
    parentGuid: null, name: "effect-inherit", x: 700, y: 470, width: 140, height: 100, background: WHITE, clipsContent: true,
  });
  const effectInst = addInstance(fEffect.context, ctx, page3, {
    parentGuid: fEffect.id, name: "EffectBox", symbolId: effectBox.id,
    x: 10, y: 10, width: 120, height: 80,
  });

  // 26. opacity-chain
  const fOpacity = addFrame(effectInst.context, ctx, page3, {
    parentGuid: null, name: "opacity-chain", x: 870, y: 470, width: 280, height: 100, background: WHITE, clipsContent: true,
  });
  const opacityFull = addInstance(fOpacity.context, ctx, page3, {
    parentGuid: fOpacity.id, name: "full", symbolId: level2.id,
    x: 10, y: 22, width: 120, height: 56,
  });
  const opacityHalf = addInstance(opacityFull.context, ctx, page3, {
    parentGuid: fOpacity.id, name: "half", symbolId: level2.id,
    x: 150, y: 22, width: 120, height: 56,
    opacity: 0.5,
  });

  // ===========================================================================
  // Canvas 4: Constraints
  // ===========================================================================
  const constraintBox = addSymbol(opacityHalf.context, ctx, page4, {
    name: "ConstraintBox", x: 0, y: -600, width: 200, height: 120, background: WHITE, cornerRadius: 12, clipsContent: true,
  });
  const cbInner = addRoundedRect(constraintBox.context, ctx, page4, {
    parentGuid: constraintBox.id, name: "inner",
    x: 20, y: 20, width: 160, height: 80,
    fill: solidPaint(IOS_BLUE),
    cornerRadius: 8,
    constraints: constraintsFor("STRETCH", "STRETCH"),
  });

  const constraintMixed = addSymbol(cbInner.context, ctx, page4, {
    name: "ConstraintMixed", x: 300, y: -600, width: 200, height: 120, background: IOS_GRAY_BG, cornerRadius: 12, clipsContent: true,
  });
  const cmTL = addRoundedRect(constraintMixed.context, ctx, page4, {
    parentGuid: constraintMixed.id, name: "top-left",
    x: 10, y: 10, width: 40, height: 40,
    fill: solidPaint(IOS_RED),
    cornerRadius: 6,
    constraints: constraintsFor("MIN", "MIN"),
  });
  const cmTR = addRoundedRect(cmTL.context, ctx, page4, {
    parentGuid: constraintMixed.id, name: "top-right",
    x: 150, y: 10, width: 40, height: 40,
    fill: solidPaint(IOS_GREEN),
    cornerRadius: 6,
    constraints: constraintsFor("MAX", "MIN"),
  });
  const cmCenter = addEllipse(cmTR.context, ctx, page4, {
    parentGuid: constraintMixed.id, name: "center",
    x: 85, y: 45, width: 30, height: 30,
    fill: IOS_PURPLE,
    constraints: constraintsFor("CENTER", "CENTER"),
  });
  const cmBottom = addRoundedRect(cmCenter.context, ctx, page4, {
    parentGuid: constraintMixed.id, name: "bottom-bar",
    x: 10, y: 90, width: 180, height: 20,
    fill: solidPaint(IOS_ORANGE),
    cornerRadius: 4,
    constraints: constraintsFor("STRETCH", "MAX"),
  });

  const constraintScale = addSymbol(cmBottom.context, ctx, page4, {
    name: "ConstraintScale", x: 600, y: -600, width: 200, height: 120, background: WHITE, cornerRadius: 12, clipsContent: true,
  });
  const csChild = addRoundedRect(constraintScale.context, ctx, page4, {
    parentGuid: constraintScale.id, name: "scaled",
    x: 50, y: 30, width: 100, height: 60,
    fill: solidPaint(IOS_BLUE),
    cornerRadius: 8,
    constraints: constraintsFor("SCALE", "SCALE"),
  });

  // Canvas 4 test frames
  const canvas4Tests: readonly TestFrame[] = [
    // 27. constraint-stretch-full
    ({ context, x, y }) => {
      const f = addFrame(context, ctx, page4, { parentGuid: null, name: "constraint-stretch-full", x, y, width: 320, height: 200, background: IOS_GRAY_BG, clipsContent: true });
      return addInstance(f.context, ctx, page4, { parentGuid: f.id, name: "ConstraintBox-stretched", symbolId: constraintBox.id, x: 10, y: 10, width: 300, height: 180 }).context;
    },
    // 28. constraint-no-resize
    ({ context, x, y }) => {
      const f = addFrame(context, ctx, page4, { parentGuid: null, name: "constraint-no-resize", x, y, width: 220, height: 140, background: IOS_GRAY_BG, clipsContent: true });
      return addInstance(f.context, ctx, page4, { parentGuid: f.id, name: "ConstraintBox-same", symbolId: constraintBox.id, x: 10, y: 10, width: 200, height: 120 }).context;
    },
    // 29. constraint-mixed
    ({ context, x, y }) => {
      const f = addFrame(context, ctx, page4, { parentGuid: null, name: "constraint-mixed", x, y, width: 340, height: 200, background: WHITE, clipsContent: true });
      return addInstance(f.context, ctx, page4, { parentGuid: f.id, name: "ConstraintMixed-large", symbolId: constraintMixed.id, x: 10, y: 10, width: 320, height: 180 }).context;
    },
    // 30. constraint-mixed-shrink
    ({ context, x, y }) => {
      const f = addFrame(context, ctx, page4, { parentGuid: null, name: "constraint-mixed-shrink", x, y, width: 180, height: 100, background: WHITE, clipsContent: true });
      return addInstance(f.context, ctx, page4, { parentGuid: f.id, name: "ConstraintMixed-small", symbolId: constraintMixed.id, x: 10, y: 10, width: 160, height: 80 }).context;
    },
    // 31. constraint-scale
    ({ context, x, y }) => {
      const f = addFrame(context, ctx, page4, { parentGuid: null, name: "constraint-scale", x, y, width: 320, height: 200, background: IOS_GRAY_BG, clipsContent: true });
      return addInstance(f.context, ctx, page4, { parentGuid: f.id, name: "ConstraintScale-large", symbolId: constraintScale.id, x: 10, y: 10, width: 300, height: 180 }).context;
    },
  ];
  const canvas4Layout: readonly { readonly x: number; readonly y: number }[] = [
    { x: 50, y: 50 }, { x: 400, y: 50 },
    { x: 50, y: 280 }, { x: 420, y: 280 },
    { x: 50, y: 510 },
  ];
  const contextAfterCanvas4 = canvas4Tests.reduce<FigDocumentContext>(
    (acc, fn, i) => fn({ context: acc, x: canvas4Layout[i].x, y: canvas4Layout[i].y }),
    csChild.context,
  );

  // ===========================================================================
  // Canvas 5: Variants
  // ===========================================================================
  const buttonDefault = addSymbol(contextAfterCanvas4, ctx, page5, {
    name: "ButtonDefault", x: 0, y: -600, width: 120, height: 44, background: IOS_BLUE, cornerRadius: 12, clipsContent: true,
  });
  const bdLabel = addRoundedRect(buttonDefault.context, ctx, page5, {
    parentGuid: buttonDefault.id, name: "label",
    x: 20, y: 10, width: 80, height: 24,
    fill: solidPaint(WHITE, 0.2),
    cornerRadius: 4,
    constraints: constraintsFor("STRETCH", "CENTER"),
  });

  const buttonActive = addSymbol(bdLabel.context, ctx, page5, {
    name: "ButtonActive", x: 200, y: -600, width: 120, height: 44, background: IOS_GREEN, cornerRadius: 12, clipsContent: true,
  });
  const baLabel = addRoundedRect(buttonActive.context, ctx, page5, {
    parentGuid: buttonActive.id, name: "label",
    x: 20, y: 10, width: 80, height: 24,
    fill: solidPaint(WHITE, 0.3),
    cornerRadius: 4,
    constraints: constraintsFor("STRETCH", "CENTER"),
  });

  const buttonDisabled = addSymbol(baLabel.context, ctx, page5, {
    name: "ButtonDisabled", x: 400, y: -600, width: 120, height: 44, background: IOS_GRAY_3, cornerRadius: 12, clipsContent: true,
  });
  const bdsLabel = addRoundedRect(buttonDisabled.context, ctx, page5, {
    parentGuid: buttonDisabled.id, name: "label",
    x: 20, y: 10, width: 80, height: 24,
    fill: solidPaint(WHITE, 0.1),
    cornerRadius: 4,
    constraints: constraintsFor("STRETCH", "CENTER"),
  });

  // 32. variant-default
  const fVarDefault = addFrame(bdsLabel.context, ctx, page5, {
    parentGuid: null, name: "variant-default", x: 50, y: 50, width: 140, height: 64, background: WHITE, clipsContent: true,
  });
  const varDefaultInst = addInstance(fVarDefault.context, ctx, page5, {
    parentGuid: fVarDefault.id, name: "ButtonDefault", symbolId: buttonDefault.id,
    x: 10, y: 10, width: 120, height: 44,
  });

  // 33. variant-override
  const fVarOverride = addFrame(varDefaultInst.context, ctx, page5, {
    parentGuid: null, name: "variant-override", x: 220, y: 50, width: 140, height: 64, background: WHITE, clipsContent: true,
  });
  const varOverrideInst = addInstance(fVarOverride.context, ctx, page5, {
    parentGuid: fVarOverride.id, name: "ButtonActive-via-override", symbolId: buttonDefault.id,
    x: 10, y: 10, width: 120, height: 44,
    overrideSymbolId: buttonActive.id,
  });

  // 34. variant-all-states
  const fVarAll = addFrame(varOverrideInst.context, ctx, page5, {
    parentGuid: null, name: "variant-all-states", x: 390, y: 50, width: 420, height: 64, background: WHITE, clipsContent: true,
  });
  const all1 = addInstance(fVarAll.context, ctx, page5, {
    parentGuid: fVarAll.id, name: "default", symbolId: buttonDefault.id,
    x: 10, y: 10, width: 120, height: 44,
  });
  const all2 = addInstance(all1.context, ctx, page5, {
    parentGuid: fVarAll.id, name: "active", symbolId: buttonDefault.id,
    x: 150, y: 10, width: 120, height: 44,
    overrideSymbolId: buttonActive.id,
  });
  const finalContext = addInstance(all2.context, ctx, page5, {
    parentGuid: fVarAll.id, name: "disabled", symbolId: buttonDefault.id,
    x: 290, y: 10, width: 120, height: 44,
    overrideSymbolId: buttonDisabled.id,
  });

  // ===========================================================================
  // Output
  // ===========================================================================
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  for (const subdir of ["actual", "snapshots"]) {
    const dir = path.join(OUTPUT_DIR, subdir);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const exported = await exportFig(finalContext.context);
  fs.writeFileSync(OUTPUT_FILE, exported.data);

  console.log(`Generated: ${OUTPUT_FILE}`);
  console.log(`Size: ${(exported.data.length / 1024).toFixed(1)} KB`);
  console.log(`\n=== Structure ===`);
  console.log(`5 canvases\n`);
  console.log(`Canvas 1: "Components" — 8 test frames (button-inherit, card variants, navbar variants)`);
  console.log(`Canvas 2: "Clipping" — 8 test frames (avatar, rounded container, nested clip)`);
  console.log(`Canvas 3: "Deep Nesting" — 10 test frames (depth-2..5, multi-depth, effect-inherit, opacity-chain)`);
  console.log(`Canvas 4: "Constraints" — 5 test frames (STRETCH, mixed, SCALE)`);
  console.log(`Canvas 5: "Variants" — 3 test frames (variant-default, variant-override, variant-all-states)`);
}

generate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
