/**
 * @file Unit spec for the effect-bounds expansion functions.
 *
 * Anchors the per-effect-type outward extent against the values
 * observable in Figma's own SVG export. Each case is calibrated
 * directly from a fixture in the App Store Template
 * (`Event Card.svg`: 362×296 + DROP_SHADOW(radius=12, offset=(0,4))
 * → viewBox 386×320 with content at (12, 8)).
 */

import { describe, it, expect } from "vitest";
import type { FigEffectType, FigNode } from "@higma-document-models/fig/types";
import { computeNodeEffectExpansion, computeRootEffectExpansion } from "./effect-bounds";
import { EFFECT_TYPE_VALUES } from "@higma-document-models/fig/constants";

function effectType(type: FigEffectType): { readonly value: number; readonly name: FigEffectType } {
  return { value: EFFECT_TYPE_VALUES[type], name: type };
}

function makeNode(effects: NonNullable<FigNode["effects"]>): FigNode {
  return { effects } as unknown as FigNode;
}

describe("computeNodeEffectExpansion", () => {
  it("returns zero expansion for a node without effects", () => {
    expect(computeNodeEffectExpansion({ effects: undefined })).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
    expect(computeNodeEffectExpansion({ effects: [] })).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });

  it("Event Card DROP_SHADOW(radius=12, offset=(0,4)) expands to (12, 12, 8, 16)", () => {
    // Calibrated from `Event Card.svg`:
    //   viewBox 0 0 386 320, BG rect at (12, 8) size 362×296.
    //   Source SYMBOL is 362×296 → padding = (12,12,8,16).
    const exp = computeNodeEffectExpansion(makeNode([
      { type: effectType("DROP_SHADOW"), radius: 12, offset: { x: 0, y: 4 }, visible: true },
    ]));
    expect(exp).toEqual({ left: 12, right: 12, top: 8, bottom: 16 });
  });

  it("DROP_SHADOW with spread adds to every side", () => {
    const exp = computeNodeEffectExpansion(makeNode([
      { type: effectType("DROP_SHADOW"), radius: 4, spread: 2, offset: { x: 0, y: 0 }, visible: true },
    ]));
    expect(exp).toEqual({ left: 6, right: 6, top: 6, bottom: 6 });
  });

  it("DROP_SHADOW with positive offset > radius+spread still shows zero expansion on the opposite side", () => {
    // halo = radius + spread = 1, offset.x = 5 → right=6, left=max(0, 1-5)=0
    const exp = computeNodeEffectExpansion(makeNode([
      { type: effectType("DROP_SHADOW"), radius: 1, offset: { x: 5, y: -5 }, visible: true },
    ]));
    expect(exp).toEqual({ left: 0, right: 6, top: 6, bottom: 0 });
  });

  it("FOREGROUND_BLUR expands all sides uniformly by radius", () => {
    const exp = computeNodeEffectExpansion(makeNode([
      { type: effectType("FOREGROUND_BLUR"), radius: 8, visible: true },
    ]));
    expect(exp).toEqual({ left: 8, right: 8, top: 8, bottom: 8 });
  });

  it("FOREGROUND_BLUR radius controls the outward expansion", () => {
    const exp = computeNodeEffectExpansion(makeNode([
      { type: effectType("FOREGROUND_BLUR"), radius: 5, visible: true },
    ]));
    expect(exp).toEqual({ left: 5, right: 5, top: 5, bottom: 5 });
  });

  it("INNER_SHADOW contributes zero outward expansion", () => {
    const exp = computeNodeEffectExpansion(makeNode([
      { type: effectType("INNER_SHADOW"), radius: 20, offset: { x: 0, y: 0 }, visible: true },
    ]));
    expect(exp).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });

  it("BACKGROUND_BLUR contributes zero outward expansion", () => {
    const exp = computeNodeEffectExpansion(makeNode([
      { type: effectType("BACKGROUND_BLUR"), radius: 20, visible: true },
    ]));
    expect(exp).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });

  it("invisible effects contribute nothing", () => {
    const exp = computeNodeEffectExpansion(makeNode([
      { type: effectType("DROP_SHADOW"), radius: 12, offset: { x: 0, y: 0 }, visible: false },
    ]));
    expect(exp).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });

  it("multiple effects pick per-side max, never sum", () => {
    const exp = computeNodeEffectExpansion(makeNode([
      // shadow extending right
      { type: effectType("DROP_SHADOW"), radius: 4, offset: { x: 4, y: 0 }, visible: true },
      // blur extending uniformly
      { type: effectType("FOREGROUND_BLUR"), radius: 6, visible: true },
    ]));
    expect(exp).toEqual({ left: 6, right: 8, top: 6, bottom: 6 });
  });

  it("accepts Kiwi enum effect types", () => {
    const exp = computeNodeEffectExpansion(makeNode([
      { type: effectType("DROP_SHADOW"), radius: 2, offset: { x: 0, y: 0 }, visible: true },
    ]));
    expect(exp).toEqual({ left: 2, right: 2, top: 2, bottom: 2 });
  });
});

describe("computeRootEffectExpansion", () => {
  it("returns zero expansion for an empty node list", () => {
    expect(computeRootEffectExpansion([])).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });

  it("takes the per-side maximum across multiple root nodes", () => {
    const exp = computeRootEffectExpansion([
      makeNode([{ type: effectType("DROP_SHADOW"), radius: 4, offset: { x: 4, y: 0 }, visible: true }]),
      makeNode([{ type: effectType("DROP_SHADOW"), radius: 4, offset: { x: -4, y: 0 }, visible: true }]),
    ]);
    // node 1: left=0 right=8 top=4 bottom=4
    // node 2: left=8 right=0 top=4 bottom=4
    // max:    left=8 right=8 top=4 bottom=4
    expect(exp).toEqual({ left: 8, right: 8, top: 4, bottom: 4 });
  });
});
