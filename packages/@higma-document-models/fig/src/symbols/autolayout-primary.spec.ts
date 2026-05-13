/**
 * @file Unit tests for autolayout-primary.
 *
 * Covers the aspect-lock verification gate inside `resolveAutoLayoutFrame`
 * (regression for real Figma community files: icon INSTANCEs author
 * `proportionsConstrained=true` without `targetAspectRatio`) and a few
 * primary-axis layout permutations so the SoT module has its own
 * dedicated coverage instead of relying solely on the
 * fixture-driven `spec/autolayout.spec.ts`.
 */

import {
  applyAutoLayoutPrimaryAxis,
  resolveAutoLayoutFrame,
  type PrimaryAxisChild,
  type PrimaryAxisParent,
} from "./autolayout-primary";

type Vec = { x: number; y: number };

type ParentOpts = {
  mode?: "VERTICAL" | "HORIZONTAL" | "NONE" | "GRID";
  padding?: number | { top: number; right: number; bottom: number; left: number };
  spacing?: number;
  primaryAlign?: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN" | "SPACE_EVENLY" | "SPACE_AROUND";
  counterAlign?: "MIN" | "CENTER" | "MAX";
  proportionsConstrained?: boolean;
  targetAspectRatio?: Vec;
  name?: string;
};

function buildAutoLayout(opts: ParentOpts): PrimaryAxisParent["autoLayout"] {
  if (opts.mode === undefined) {
    return undefined;
  }
  return {
    stackMode: { name: opts.mode },
    stackPadding: opts.padding,
    stackSpacing: opts.spacing,
    stackPrimaryAlignItems: opts.primaryAlign ? { name: opts.primaryAlign } : undefined,
    stackCounterAlignItems: opts.counterAlign ? { name: opts.counterAlign } : undefined,
  };
}

function parent(size: Vec, opts: ParentOpts = {}): PrimaryAxisParent & { name?: string } {
  return {
    size,
    name: opts.name,
    proportionsConstrained: opts.proportionsConstrained,
    targetAspectRatio: opts.targetAspectRatio,
    autoLayout: buildAutoLayout(opts),
  };
}

type ChildOpts = { grow?: number; absolute?: boolean; visible?: boolean };

function buildChildLayoutConstraints(opts: ChildOpts): PrimaryAxisChild["layoutConstraints"] {
  if (opts.grow === undefined && !opts.absolute) {
    return undefined;
  }
  return {
    stackPositioning: opts.absolute ? { name: "ABSOLUTE" } : undefined,
    stackChildPrimaryGrow: opts.grow,
  };
}

function child(size: Vec, opts: ChildOpts = {}): PrimaryAxisChild {
  return {
    size,
    visible: opts.visible,
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    layoutConstraints: buildChildLayoutConstraints(opts),
  };
}

describe("resolveAutoLayoutFrame — aspect-lock verification gate", () => {
  it("does NOT throw when proportionsConstrained=true and targetAspectRatio is absent", () => {
    // Real Figma case: icon INSTANCEs (e.g. mingcute:dribbble-line) author
    // `{size, proportionsConstrained: true}` self-overrides without an
    // explicit targetAspectRatio. The renderer must accept that as
    // "lock to whatever size's ratio currently is".
    const p = parent({ x: 24, y: 24 }, {
      mode: "HORIZONTAL",
      proportionsConstrained: true,
      name: "mingcute:dribbble-line",
    });
    expect(() => resolveAutoLayoutFrame(p, [])).not.toThrow();
    expect(resolveAutoLayoutFrame(p, []).parent).toBe(p);
  });

  it("does NOT throw when proportionsConstrained=true on a non-autolayout parent", () => {
    // The aspect-lock gate runs even for plain FRAMEs (autoLayout=undefined).
    const p = parent({ x: 16, y: 16 }, { proportionsConstrained: true });
    expect(() => resolveAutoLayoutFrame(p, [])).not.toThrow();
  });

  it("does not throw when proportionsConstrained is false even if no targetAspectRatio", () => {
    const p = parent({ x: 100, y: 50 }, { mode: "VERTICAL", proportionsConstrained: false });
    expect(() => resolveAutoLayoutFrame(p, [])).not.toThrow();
  });

  it("accepts proportionsConstrained=true with a targetAspectRatio that matches size", () => {
    const p = parent({ x: 320, y: 180 }, {
      mode: "HORIZONTAL",
      proportionsConstrained: true,
      targetAspectRatio: { x: 16, y: 9 },
    });
    expect(() => resolveAutoLayoutFrame(p, [])).not.toThrow();
  });

  it("throws when proportionsConstrained=true with an explicit target that does NOT match size", () => {
    const p = parent({ x: 100, y: 50 }, {
      mode: "HORIZONTAL",
      proportionsConstrained: true,
      targetAspectRatio: { x: 16, y: 9 },
    });
    expect(() => resolveAutoLayoutFrame(p, [])).toThrow(/AutoLayout aspect lock mismatch/);
  });

  it("throws when proportionsConstrained=true and target is set but parent.size is missing (no auto-layout)", () => {
    // Bypass auto-layout so applyHugSizing's own size-requirement does not
    // fire first — exercises applyAspectLock's size-required branch.
    const p: PrimaryAxisParent = {
      proportionsConstrained: true,
      targetAspectRatio: { x: 1, y: 1 },
    };
    expect(() => resolveAutoLayoutFrame(p, [])).toThrow(/aspect lock requires parent size/);
  });

  it("throws when targetAspectRatio.y is zero (degenerate)", () => {
    const p = parent({ x: 10, y: 10 }, {
      mode: "HORIZONTAL",
      proportionsConstrained: true,
      targetAspectRatio: { x: 1, y: 0 },
    });
    expect(() => resolveAutoLayoutFrame(p, [])).toThrow(/aspect lock degenerate/);
  });
});

describe("applyAutoLayoutPrimaryAxis — distribution", () => {
  it("returns children unchanged when parent has no autoLayout", () => {
    const p = parent({ x: 100, y: 100 });
    const cs = [child({ x: 10, y: 10 })];
    expect(applyAutoLayoutPrimaryAxis(p, cs)).toBe(cs);
  });

  it("returns children unchanged when stackMode is NONE", () => {
    const p = parent({ x: 100, y: 100 }, { mode: "NONE" });
    const cs = [child({ x: 10, y: 10 })];
    expect(applyAutoLayoutPrimaryAxis(p, cs)).toBe(cs);
  });

  it("MIN: lays children left-to-right with spacing, starting at padding.left", () => {
    const p = parent({ x: 200, y: 50 }, { mode: "HORIZONTAL", padding: 10, spacing: 4 });
    const a = child({ x: 30, y: 20 });
    const b = child({ x: 40, y: 20 });
    const c = child({ x: 50, y: 20 });
    const out = applyAutoLayoutPrimaryAxis(p, [a, b, c]);
    expect(out[0].transform!.m02).toBeCloseTo(10);
    expect(out[1].transform!.m02).toBeCloseTo(10 + 30 + 4);
    expect(out[2].transform!.m02).toBeCloseTo(10 + 30 + 4 + 40 + 4);
  });

  it("SPACE_BETWEEN: first flush to start, last flush to end", () => {
    const p = parent({ x: 200, y: 50 }, { mode: "HORIZONTAL", padding: 0, primaryAlign: "SPACE_BETWEEN" });
    const a = child({ x: 40, y: 20 });
    const b = child({ x: 40, y: 20 });
    const c = child({ x: 40, y: 20 });
    const out = applyAutoLayoutPrimaryAxis(p, [a, b, c]);
    // free = 200 - 120 = 80; gap = 80/2 = 40
    expect(out[0].transform!.m02).toBeCloseTo(0);
    expect(out[1].transform!.m02).toBeCloseTo(40 + 40);
    expect(out[2].transform!.m02).toBeCloseTo(160);
  });

  // Regression: Figma serialises what the UI calls "Space between"
  // as StackJustify=3 (Kiwi name "SPACE_EVENLY"). The sibling
  // bridge / fig-to-web CSS layer collapses both names to CSS
  // `space-between`; this spec pins the scene-graph solver to the
  // same semantics so headers like the YouTube Mobile UIKit
  // Subscription title bar render with their authored 2 px L/R
  // margins instead of the (n+1)-equal-gap drift.
  it("SPACE_EVENLY: behaves as SPACE_BETWEEN (Figma's UI 'Space between')", () => {
    const p = parent({ x: 200, y: 50 }, { mode: "HORIZONTAL", padding: 0, primaryAlign: "SPACE_EVENLY" });
    const a = child({ x: 40, y: 20 });
    const b = child({ x: 40, y: 20 });
    const c = child({ x: 40, y: 20 });
    const out = applyAutoLayoutPrimaryAxis(p, [a, b, c]);
    // free = 200 - 120 = 80; gap = 80/2 = 40; first at 0
    expect(out[0].transform!.m02).toBeCloseTo(0);
    expect(out[1].transform!.m02).toBeCloseTo(40 + 40);
    expect(out[2].transform!.m02).toBeCloseTo(160);
  });

  it("CENTER: block centred within content span", () => {
    const p = parent({ x: 200, y: 50 }, { mode: "HORIZONTAL", padding: 0, spacing: 0, primaryAlign: "CENTER" });
    const a = child({ x: 40, y: 20 });
    const b = child({ x: 40, y: 20 });
    const out = applyAutoLayoutPrimaryAxis(p, [a, b]);
    // block = 80; free = 120; start = 60
    expect(out[0].transform!.m02).toBeCloseTo(60);
    expect(out[1].transform!.m02).toBeCloseTo(100);
  });

  it("FILL grow: distributes leftover space among grow=1 children", () => {
    const p = parent({ x: 200, y: 50 }, { mode: "HORIZONTAL", padding: 0, spacing: 0 });
    const fixed = child({ x: 50, y: 20 });
    const grower = child({ x: 0, y: 20 }, { grow: 1 });
    const out = applyAutoLayoutPrimaryAxis(p, [fixed, grower]);
    // free = 200 - 50 = 150 → grower becomes 150 wide
    expect(out[1].size?.x).toBeCloseTo(150);
    expect(out[1].transform!.m02).toBeCloseTo(50);
  });

  it("skips ABSOLUTE-positioned children", () => {
    const p = parent({ x: 200, y: 50 }, { mode: "HORIZONTAL", padding: 0, spacing: 0 });
    const a = child({ x: 50, y: 20 });
    const abs = child({ x: 30, y: 30 }, { absolute: true });
    const c = child({ x: 50, y: 20 });
    const out = applyAutoLayoutPrimaryAxis(p, [a, abs, c]);
    expect(out[0].transform!.m02).toBeCloseTo(0);
    // ABSOLUTE child is left at its authored transform (m02=0 from helper).
    expect(out[1]).toBe(abs);
    expect(out[2].transform!.m02).toBeCloseTo(50);
  });

  it("skips invisible children", () => {
    const p = parent({ x: 200, y: 50 }, { mode: "HORIZONTAL", padding: 0, spacing: 0 });
    const a = child({ x: 50, y: 20 });
    const hidden = child({ x: 30, y: 30 }, { visible: false });
    const c = child({ x: 50, y: 20 });
    const out = applyAutoLayoutPrimaryAxis(p, [a, hidden, c]);
    expect(out[0].transform!.m02).toBeCloseTo(0);
    expect(out[1]).toBe(hidden);
    expect(out[2].transform!.m02).toBeCloseTo(50);
  });

  // Regression: a 180°-rotated child stores `m02 / m12 = (w, h)`
  // because the rotation pins the local origin at the AABB's
  // bottom-right corner. Writing the cursor straight into `m12`
  // (the pre-fix behaviour) put the AABB's top-left at
  // `cursor − h` and dragged the child up off the parent — the
  // YouTube Mobile UIKit Short-screen down-button regression.
  // The solver now reconstructs `m12 = cursor + originOffset` so
  // the AABB top-left lands exactly at the requested cursor.
  it("places 180°-rotated children by their AABB, not their local origin", () => {
    const p = parent({ x: 36, y: 54 }, { mode: "VERTICAL", padding: 0, spacing: 0, primaryAlign: "MIN" });
    // 180° rotation: local axes flipped, origin at AABB bottom-right
    // i.e. (m02, m12) = (w, h).
    const rotated: PrimaryAxisChild = {
      size: { x: 36, y: 36 },
      transform: { m00: -1, m01: 0, m02: 36, m10: 0, m11: -1, m12: 36 },
    };
    const text: PrimaryAxisChild = {
      size: { x: 36, y: 14 },
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    };
    const out = applyAutoLayoutPrimaryAxis(p, [rotated, text]);
    // First child (rotated): AABB top at y=0 ⇒ origin at y=0+36=36.
    expect(out[0].transform!.m02).toBeCloseTo(36);
    expect(out[0].transform!.m12).toBeCloseTo(36);
    // Second child (unrotated): AABB top at y=36 ⇒ origin at y=36+0=36.
    expect(out[1].transform!.m02).toBeCloseTo(0);
    expect(out[1].transform!.m12).toBeCloseTo(36);
  });

  it("places 90°-rotated children using AABB extent on the primary axis", () => {
    // A 90° CCW rotation maps local (w, 0) → (0, w) and local
    // (0, h) → (-h, 0), so the AABB along the horizontal axis is `h`
    // wide and along the vertical axis is `w` tall. A 20×60 child
    // rotated 90° CCW and dropped into a horizontal stack should
    // occupy 60 px of primary span, not 20.
    const p = parent({ x: 200, y: 80 }, { mode: "HORIZONTAL", padding: 0, spacing: 0, primaryAlign: "MIN" });
    const rotated: PrimaryAxisChild = {
      size: { x: 20, y: 60 },
      // 90° CCW: m00=0, m01=1, m10=-1, m11=0; origin offset chosen so
      // that AABB top-left lands at (0, 0). Without an offset:
      // corners would be (0,0), (0,-20), (60,0), (60,-20) ⇒ AABB
      // top-left at (0, -20). Shift origin by (0, 20) to anchor the
      // AABB top-left at (0, 0).
      transform: { m00: 0, m01: 1, m02: 0, m10: -1, m11: 0, m12: 20 },
    };
    const trailing: PrimaryAxisChild = {
      size: { x: 40, y: 40 },
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    };
    const out = applyAutoLayoutPrimaryAxis(p, [rotated, trailing]);
    // First child: AABB top-left lands at (0, _). Origin offset along
    // the horizontal axis was 0 (origin sits at the AABB's left
    // already), so m02 stays at 0.
    expect(out[0].transform!.m02).toBeCloseTo(0);
    // Second child must start at primaryCursor = 60 (the rotated
    // child's AABB width), confirming we account for the rotated
    // extent, not the local 20-px width.
    expect(out[1].transform!.m02).toBeCloseTo(60);
  });
});
