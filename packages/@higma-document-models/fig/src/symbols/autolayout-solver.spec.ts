/**
 * @file Unit tests for autolayout-solver.
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
} from "./autolayout-solver";

type Vec = { x: number; y: number };

type ParentOpts = {
  mode?: "VERTICAL" | "HORIZONTAL" | "NONE" | "GRID";
  padding?: number | { top: number; right: number; bottom: number; left: number };
  spacing?: number;
  counterSpacing?: number;
  primaryAlign?: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN" | "SPACE_EVENLY" | "SPACE_AROUND";
  counterAlign?: "MIN" | "CENTER" | "MAX";
  primaryAlignContent?: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN" | "SPACE_EVENLY" | "SPACE_AROUND";
  wrap?: boolean;
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
    stackCounterSpacing: opts.counterSpacing,
    stackPrimaryAlignItems: opts.primaryAlign ? { name: opts.primaryAlign } : undefined,
    stackCounterAlignItems: opts.counterAlign ? { name: opts.counterAlign } : undefined,
    stackPrimaryAlignContent: opts.primaryAlignContent ? { name: opts.primaryAlignContent } : undefined,
    stackWrap: opts.wrap ? { name: "WRAP" } : undefined,
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
    const out = resolveAutoLayoutFrame(p, [a, b]).children;
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

  // Regression: 270° CW rotation is the fourth cardinal case the
  // AABB fix has to honour. For a 20×60 child rotated 270° CW
  // (= 90° CCW spun the other way; matrix {m00:0, m01:-1, m10:1,
  // m11:0}), the AABB along the horizontal parent axis is `h` wide
  // and along the vertical axis is `w` tall. Without an explicit
  // 270° case, a future "simplify rotation handling" refactor could
  // silently regress this branch — the unit test makes that
  // impossible.
  it("places 270°-rotated children by their AABB on the primary axis", () => {
    const p = parent({ x: 200, y: 80 }, { mode: "HORIZONTAL", padding: 0, spacing: 0, primaryAlign: "MIN" });
    // 270° CW (= -90°): m00=0, m01=-1, m10=1, m11=0; choose origin
    // so the corners (0,0), (-w,0)+origin, (0,h)+origin, (-w,h)+origin
    // land with AABB top-left = (0,0). Corners of a 20×60 local rect
    // under this rotation: (0,0)→(0,0), (20,0)→(0,20), (0,60)→(-60,0),
    // (20,60)→(-60,20). Shift by (60, 0) to anchor AABB top-left at
    // origin: m02 = 60, m12 = 0.
    const rotated: PrimaryAxisChild = {
      size: { x: 20, y: 60 },
      transform: { m00: 0, m01: -1, m02: 60, m10: 1, m11: 0, m12: 0 },
    };
    const trailing: PrimaryAxisChild = {
      size: { x: 40, y: 40 },
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    };
    const out = applyAutoLayoutPrimaryAxis(p, [rotated, trailing]);
    // First child: AABB top-left at primary-axis cursor 0 ⇒ origin
    // offset 60 on x (the same shift we authored) keeps m02=60.
    expect(out[0].transform!.m02).toBeCloseTo(60);
    // Trailing child starts at primaryCursor = 60 — proves the
    // solver advanced by the AABB width (60), not the local width
    // (20).
    expect(out[1].transform!.m02).toBeCloseTo(60);
  });

  // Regression: the counter-axis placement (`applyCounterAxisPosition`)
  // has the same AABB-aware origin reconstruction as the primary
  // axis. A 180°-rotated 36×36 child whose CENTER alignment requires
  // it to sit at counter-axis offset (54 − 36) / 2 = 9 must produce
  // `m12 = 9 + h = 45`, otherwise the rotated AABB lands at y = -27
  // and the icon disappears above the parent.
  it("places rotated children on the counter axis using the AABB", () => {
    const p = parent({ x: 100, y: 54 }, {
      mode: "HORIZONTAL",
      padding: 0,
      spacing: 0,
      primaryAlign: "MIN",
      counterAlign: "CENTER",
    });
    const rotated: PrimaryAxisChild = {
      size: { x: 36, y: 36 },
      transform: { m00: -1, m01: 0, m02: 36, m10: 0, m11: -1, m12: 36 },
    };
    const out = resolveAutoLayoutFrame(p, [rotated]);
    // counterSpan = 54, childSpan = 36, CENTER → counter-axis offset 9.
    // AABB origin offset along y = m12 - aabbMin.y = 36 - 0 = 36.
    // Final m12 = 9 + 36 = 45.
    expect(out.children[0].transform!.m12).toBeCloseTo(45);
  });
});

// 90°-rotated zero-thickness LINE used by real Figma exports for
// vertical separators inside stat rows. Authored by Figma as a
// horizontal line (`size.y = 0`) rotated 90° CCW so the visible
// segment runs vertically. The AABB after rotation is 0-wide and
// `size.x` tall, which is what the wrap solver must consume.
function rotatedLineCCW(localWidth: number): PrimaryAxisChild {
  // Real .fig files carry the matrix Figma writes for a 90° CCW
  // rotation about Math.PI/2: m00 ≈ 4.37e-8 (rounding residue),
  // m01 = -1, m10 = 1, m11 ≈ 4.37e-8. The solver matches with a
  // tolerance; we mirror the real values here so the test catches a
  // future "tighten tolerance to exact zero" regression.
  return {
    size: { x: localWidth, y: 0 },
    transform: { m00: 4.371139183945161e-8, m01: -1, m02: 0, m10: 1, m11: 4.371139183945161e-8, m12: 0 },
  };
}

describe("resolveAutoLayoutFrame — WRAP layout (Frame 57 regressions)", () => {
  // Regression: e-commerce template "Frame 57" (.fig ID 35:763) is
  // HORIZONTAL + WRAP + SPACE_EVENLY + counterAlign=CENTER with a
  // 90°-rotated zero-thickness LINE separator between two 48-tall
  // frames inside a 278×52 parent. Pre-fix, three bugs compounded:
  //   1. The wrap decision counted the literal `stackSpacing=32`,
  //      pushing total >278 and forcing items onto separate lines.
  //   2. The rotated LINE was sized by `size.x = 52`, so even with
  //      the literal-spacing fix the items still didn't fit.
  //   3. Per-child counter alignment within the line was missing —
  //      48-tall frames sat at m12=0 inside a 52-tall line instead
  //      of being CENTER-aligned at m12=2.
  // The fix lives in `applyWrapLayout` + `wrapChildMetrics` +
  // `resolveCounterAlignOffset`; this test pins all three behaviours
  // so a future "simplify wrap layout" refactor can't quietly break
  // any one of them.
  it("places SPACE_EVENLY + CENTER children on one line with a rotated zero-thickness separator (Frame 57 35:763)", () => {
    const p = parent({ x: 278, y: 52 }, {
      mode: "HORIZONTAL",
      padding: 0,
      spacing: 32,
      counterSpacing: 32,
      primaryAlign: "SPACE_EVENLY",
      counterAlign: "CENTER",
      wrap: true,
    });
    const frameA = child({ x: 106, y: 48 });
    // m02=133.5 is the authored origin of the separator inside the
    // parent. The wrap solver must rewrite this to fit the
    // SPACE_EVENLY distribution while preserving the AABB top-left.
    const separator: PrimaryAxisChild = {
      ...rotatedLineCCW(52),
      transform: { ...rotatedLineCCW(52).transform!, m02: 133.5 },
    };
    const frameB = child({ x: 117, y: 48 });
    const out = resolveAutoLayoutFrame(p, [frameA, separator, frameB]).children;
    // Primary positions: SPACE_EVENLY with effective widths
    // [106, 0, 117] and span 278 → gap = (278-223)/2 = 27.5.
    expect(out[0].transform!.m02).toBeCloseTo(0);
    expect(out[1].transform!.m02).toBeCloseTo(133.5, 3);
    expect(out[2].transform!.m02).toBeCloseTo(161);
    // Counter positions: line counter = max(48, 52, 48) = 52,
    // parent counter span 52 → content fills the span (block start = 0).
    // Per-child CENTER inside the line: 48-tall frames sit at
    // (52-48)/2 = 2; rotated LINE counter size is 52 → offset 0.
    expect(out[0].transform!.m12).toBeCloseTo(2);
    expect(out[1].transform!.m12).toBeCloseTo(0);
    expect(out[2].transform!.m12).toBeCloseTo(2);
  });

  // Regression: with SPACE_BETWEEN / SPACE_EVENLY / SPACE_AROUND the
  // free space is distributed at layout time, so the *literal*
  // `stackSpacing` must not influence the wrap decision. Without
  // this carve-out the Frame 57 stat-row split across lines even
  // though SPACE_EVENLY happily packed everything on one line.
  it("ignores literal stackSpacing when deciding whether to wrap a SPACE_EVENLY line", () => {
    // Two 100-wide items in a 220-wide parent with spacing=40.
    // Literal sum 100+40+100 = 240 > 220 → would wrap if spacing
    // counted; AABB-only sum 200 ≤ 220 → must stay on one line.
    const p = parent({ x: 220, y: 50 }, {
      mode: "HORIZONTAL",
      padding: 0,
      spacing: 40,
      primaryAlign: "SPACE_EVENLY",
      wrap: true,
    });
    const a = child({ x: 100, y: 40 });
    const b = child({ x: 100, y: 40 });
    const out = resolveAutoLayoutFrame(p, [a, b]).children;
    // Both children share the same line ⇒ m12 stays at 0
    // (single 40-tall line, no per-child counter alignment is set).
    expect(out[0].transform!.m12).toBeCloseTo(0);
    expect(out[1].transform!.m12).toBeCloseTo(0);
    // SPACE_EVENLY on a 2-item line: free=20, gap=20 ⇒ second item
    // at 120. If we had wrapped, the second item would be at 0
    // (start of the second line).
    expect(out[0].transform!.m02).toBeCloseTo(0);
    expect(out[1].transform!.m02).toBeCloseTo(120);
  });

  // Regression: when `stackSpacing` is the dominant cue (MIN / CENTER
  // align, no space-* distribution) the wrap decision MUST count it
  // — otherwise a vertical menu with spacing=8 would refuse to wrap
  // any row that fit edge-to-edge without spacing. This test pins
  // that the carve-out is scoped to space-* alignments only.
  it("still counts literal stackSpacing for MIN alignment when deciding to wrap", () => {
    // Two 100-wide items in a 220-wide parent with spacing=40.
    // MIN alignment → literal sum 240 > 220 → must wrap.
    const p = parent({ x: 220, y: 200 }, {
      mode: "HORIZONTAL",
      padding: 0,
      spacing: 40,
      counterSpacing: 8,
      primaryAlign: "MIN",
      wrap: true,
    });
    const a = child({ x: 100, y: 40 });
    const b = child({ x: 100, y: 40 });
    const out = resolveAutoLayoutFrame(p, [a, b]).children;
    // Both items wrap to start of their respective lines.
    expect(out[0].transform!.m02).toBeCloseTo(0);
    expect(out[1].transform!.m02).toBeCloseTo(0);
    // Second item drops to line 2: y = 40 (line 1 height) + 8 (counterSpacing).
    expect(out[0].transform!.m12).toBeCloseTo(0);
    expect(out[1].transform!.m12).toBeCloseTo(48);
  });

  // Regression: per-child counter alignment must respect the line's
  // *measured* counter size, not the parent counter span. A short
  // item inside a line that contains a tall sibling must centre
  // against the tall sibling, not against the parent.
  it("centres a short child against the tallest sibling in the same wrap line", () => {
    const p = parent({ x: 200, y: 100 }, {
      mode: "HORIZONTAL",
      padding: 0,
      spacing: 0,
      counterAlign: "CENTER",
      wrap: true,
    });
    const tall = child({ x: 60, y: 60 });
    const shortChild = child({ x: 60, y: 20 });
    const out = resolveAutoLayoutFrame(p, [tall, shortChild]).children;
    // Line counter = max(60, 20) = 60. Parent counter span = 100,
    // content block = 60, contentAlign defaults to counterAlign=CENTER
    // ⇒ block starts at (100-60)/2 = 20.
    // Tall child: line offset 0 within 60 ⇒ m12 = 20 + 0 = 20.
    expect(out[0].transform!.m12).toBeCloseTo(20);
    // Short child: per-child CENTER offset = (60-20)/2 = 20 within
    // the line ⇒ m12 = 20 + 20 = 40.
    expect(out[1].transform!.m12).toBeCloseTo(40);
  });

  // Regression: counter MAX (bottom-align within line) — the opposite
  // end of the same per-child alignment code path.
  it("bottom-aligns shorter children in a wrap line when counterAlign=MAX", () => {
    const p = parent({ x: 200, y: 100 }, {
      mode: "HORIZONTAL",
      padding: 0,
      spacing: 0,
      counterAlign: "MAX",
      wrap: true,
    });
    const tall = child({ x: 60, y: 60 });
    const shortChild = child({ x: 60, y: 20 });
    const out = resolveAutoLayoutFrame(p, [tall, shortChild]).children;
    // Line counter = 60, block starts at (100-60) = 40 (MAX).
    // Tall child: line offset 0 ⇒ m12 = 40.
    // Short child: per-child MAX offset = 60-20 = 40 within line
    //              ⇒ m12 = 40 + 40 = 80 (its bottom edge at 100).
    expect(out[0].transform!.m12).toBeCloseTo(40);
    expect(out[1].transform!.m12).toBeCloseTo(80);
  });
});
