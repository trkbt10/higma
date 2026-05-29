/**
 * @file Fixture-driven specs for the liquid layout translation.
 *
 * Each test states a small fig tree (the "before") and the exact
 * overlay the translation must produce (the "after"). The translation
 * is pure (`fig tree → guid→entry map`), so these fixtures pin its
 * behaviour without booting the emitter or a browser.
 *
 * Invariants exercised:
 *   - flex-row / flex-column / inferred-stack FIXED children → `width: %`
 *     of the parent content box;
 *   - a container's own horizontal padding / row-gap → `%`, verticals
 *     preserved as `px`;
 *   - page root → full-bleed directive; component root → none;
 *   - FILL / HUG / TEXT children and absolute / static subtrees are left
 *     untouched (no entry, or no `width`);
 *   - a missing denominator fails fast.
 */
import { describe, it, expect } from "vitest";
import type { FigNode, FigMatrix, KiwiEnumValue } from "@higma-document-models/fig/types";
import { guidToString } from "@higma-document-models/fig/domain";
import type { StyleInputs } from "../style/style";
import type { TokenIndex } from "../../tokens";
import { buildLiquidOverlay, liquidPercent, type BuildLiquidOverlayDeps } from "./liquid";

function enumName<T extends string>(name: T): KiwiEnumValue<T> {
  return { value: 0, name } as KiwiEnumValue<T>;
}

function at(x: number, y: number): FigMatrix {
  return { m00: 1, m01: 0, m02: x, m10: 0, m11: 1, m12: y };
}

const EMPTY_TOKEN_INDEX: TokenIndex = {
  colorIdForPaints: () => undefined,
  spacingIdFor: () => undefined,
  radiusIdFor: () => undefined,
  shadowIdFor: () => undefined,
  typographyIdFor: () => undefined,
};

let nextLocalId = 100;
function freshGuid(): { sessionID: number; localID: number } {
  nextLocalId += 1;
  return { sessionID: 1, localID: nextLocalId };
}

type NodeSpec = Partial<FigNode> & { readonly size: { x: number; y: number } };

/** Build a FigNode with sane required fields; children are wired via a map. */
function node(type: string, spec: NodeSpec): FigNode {
  return {
    guid: freshGuid(),
    phase: enumName("CREATED"),
    type: enumName(type),
    transform: at(0, 0),
    ...spec,
  } as unknown as FigNode;
}

/**
 * Assemble a parent → children map + matching `deps`. `childrenOf` is
 * shared between the overlay builder and the style inputs so
 * `resolveContainerLayout` sees the same tree.
 */
function scene(
  children: ReadonlyMap<FigNode, readonly FigNode[]>,
  rootKind: "page" | "component",
): BuildLiquidOverlayDeps {
  const byGuid = new Map<string, readonly FigNode[]>();
  for (const [parent, kids] of children) {
    byGuid.set(guidToString(parent.guid), kids);
  }
  const childrenOf = (n: FigNode): readonly FigNode[] => byGuid.get(guidToString(n.guid)) ?? [];
  const styleInputs: StyleInputs = {
    index: EMPTY_TOKEN_INDEX,
    imageResolver: () => undefined,
    childrenOf,
  };
  return { childrenOf, styleInputs, rootKind };
}

describe("buildLiquidOverlay — explicit horizontal stack (flex-row)", () => {
  it("rewrites FIXED child widths, horizontal padding and row-gap to %", () => {
    // 1000-wide row, 50 L/R padding (content = 900), 40 gap, three 200-wide cards.
    const card = (i: number): FigNode => node("FRAME", { size: { x: 200, y: 100 }, transform: at(50 + i * 240, 50) });
    const cards = [card(0), card(1), card(2)];
    const root = node("FRAME", {
      size: { x: 1000, y: 200 },
      stackMode: enumName("HORIZONTAL"),
      stackHorizontalPadding: 50,
      stackSpacing: 40,
    });
    const deps = scene(new Map([[root, cards]]), "page");
    const overlay = buildLiquidOverlay(root, deps);

    const rootEntry = overlay.get(guidToString(root.guid));
    expect(rootEntry?.paddingLeft).toBe("5%"); // 50 / 1000 (root containing block = own width)
    expect(rootEntry?.paddingRight).toBe("5%");
    expect(rootEntry?.paddingTop).toBe("0px");
    expect(rootEntry?.paddingBottom).toBe("0px");
    expect(rootEntry?.columnGap).toBe("4.44%"); // 40 / 900 content width
    expect(rootEntry?.rowGap).toBe("40px");
    expect(rootEntry?.root).toEqual({ maxWidth: "1000px", minHeight: "200px" });

    for (const c of cards) {
      const e = overlay.get(guidToString(c.guid));
      expect(e?.width).toBe("22.22%"); // 200 / 900 content width
    }
  });
});

describe("buildLiquidOverlay — inferred vertical stack (flex-column)", () => {
  it("rewrites counter-axis (width) and horizontal padding, leaves the vertical gap as px", () => {
    // 800×600 frame, no stackMode; three 600-wide rows at x=100 (L/R pad 100),
    // y = 50 / 250 / 450 (height 100, uniform 100 gap) → infers a column.
    const row = (y: number): FigNode => node("FRAME", { size: { x: 600, y: 100 }, transform: at(100, y) });
    const rows = [row(50), row(250), row(450)];
    const root = node("FRAME", { size: { x: 800, y: 600 } });
    const deps = scene(new Map([[root, rows]]), "page");
    const overlay = buildLiquidOverlay(root, deps);

    const rootEntry = overlay.get(guidToString(root.guid));
    expect(rootEntry?.paddingLeft).toBe("12.5%"); // 100 / 800
    expect(rootEntry?.paddingRight).toBe("12.5%");
    expect(rootEntry?.paddingTop).toBe("50px"); // vertical preserved
    expect(rootEntry?.columnGap).toBeUndefined(); // column ⇒ gap is vertical, untouched

    for (const r of rows) {
      const e = overlay.get(guidToString(r.guid));
      expect(e?.width).toBe("100%"); // 600 / 600 content width
    }
  });
});

describe("buildLiquidOverlay — sizing modes and node kinds", () => {
  it("liquefies FIXED and default-sized flow children, but never TEXT", () => {
    // `axisSizingFrom` recognises only the explicit FIXED enum (and the
    // absent default) as a width to fluidise; both map to `fixed`. TEXT
    // is excluded so its content-driven measurement is left intact.
    const fixed = node("FRAME", { size: { x: 200, y: 100 }, stackPrimarySizing: enumName("FIXED") });
    const dflt = node("FRAME", { size: { x: 200, y: 100 } });
    const textNode = node("TEXT", { size: { x: 200, y: 100 } });
    const root = node("FRAME", { size: { x: 1000, y: 100 }, stackMode: enumName("HORIZONTAL") });
    const deps = scene(new Map([[root, [fixed, dflt, textNode]]]), "page");
    const overlay = buildLiquidOverlay(root, deps);

    expect(overlay.get(guidToString(fixed.guid))?.width).toBe("20%"); // 200 / 1000
    expect(overlay.get(guidToString(dflt.guid))?.width).toBe("20%");
    expect(overlay.get(guidToString(textNode.guid))?.width).toBeUndefined();
  });
});

describe("buildLiquidOverlay — component root", () => {
  it("fluidises internals but emits no full-bleed root directive", () => {
    const card = node("FRAME", { size: { x: 200, y: 100 }, transform: at(0, 0) });
    const root = node("FRAME", { size: { x: 1000, y: 100 }, stackMode: enumName("HORIZONTAL") });
    const deps = scene(new Map([[root, [card]]]), "component");
    const overlay = buildLiquidOverlay(root, deps);

    expect(overlay.get(guidToString(root.guid))?.root).toBeUndefined();
    expect(overlay.get(guidToString(card.guid))?.width).toBe("20%");
  });
});

describe("buildLiquidOverlay — static / un-inferred frame is frozen", () => {
  it("emits no child width entries when inference declines (overlapping children)", () => {
    // Two children overlapping on Y ⇒ neither a column nor a row infers ⇒
    // the frame stays static and its children keep fixed px (no entries).
    const a = node("FRAME", { size: { x: 300, y: 200 }, transform: at(0, 0) });
    const b = node("FRAME", { size: { x: 300, y: 200 }, transform: at(10, 10) });
    const root = node("FRAME", { size: { x: 1000, y: 400 } });
    const deps = scene(new Map([[root, [a, b]]]), "page");
    const overlay = buildLiquidOverlay(root, deps);

    expect(overlay.get(guidToString(a.guid))).toBeUndefined();
    expect(overlay.get(guidToString(b.guid))).toBeUndefined();
    // The page root still carries its full-bleed directive.
    expect(overlay.get(guidToString(root.guid))?.root).toEqual({ maxWidth: "1000px", minHeight: "400px" });
  });
});

describe("liquidPercent — fail fast", () => {
  it("throws on a non-positive or non-finite denominator", () => {
    expect(() => liquidPercent(100, 0)).toThrow();
    expect(() => liquidPercent(100, -5)).toThrow();
    expect(() => liquidPercent(100, Number.NaN)).toThrow();
  });

  it("rounds to two decimals", () => {
    expect(liquidPercent(200, 900)).toBe("22.22%");
    expect(liquidPercent(50, 1000)).toBe("5%");
  });
});
