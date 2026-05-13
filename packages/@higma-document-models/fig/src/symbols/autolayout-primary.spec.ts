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

  it("SPACE_EVENLY: (n+1) equal gaps", () => {
    const p = parent({ x: 200, y: 50 }, { mode: "HORIZONTAL", padding: 0, primaryAlign: "SPACE_EVENLY" });
    const a = child({ x: 40, y: 20 });
    const b = child({ x: 40, y: 20 });
    const c = child({ x: 40, y: 20 });
    const out = applyAutoLayoutPrimaryAxis(p, [a, b, c]);
    // free = 80; gap = 80/4 = 20
    expect(out[0].transform!.m02).toBeCloseTo(20);
    expect(out[1].transform!.m02).toBeCloseTo(20 + 40 + 20);
    expect(out[2].transform!.m02).toBeCloseTo(20 + 40 + 20 + 40 + 20);
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
});
