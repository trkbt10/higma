/**
 * @file style-registry unit tests
 *
 * Pins the single-Map SoT design:
 *
 * - `buildFigStyleRegistry` walks every node and indexes the ones that
 *   are style-definitions (`styleType` set, with the paint stored in
 *   the field implied by the type — `fillPaints` for FILL,
 *   `strokePaints` for STROKE). Each style is keyed under its GUID
 *   string and (when present) its `key` (assetRef hash). Both
 *   namespaces share one map; the two key forms can't collide.
 *
 * - `resolvePaintRef` is the registry-lookup primitive: empty refs and
 *   dangling refs both return `undefined`; only registry-resolved
 *   refs return paint arrays.
 *
 * - `resolveStyledPaint` is the higher-level SoT used by every
 *   consumer (node fill/stroke, instance merge, vector
 *   per-path style overrides, text run override entries). It picks
 *   the registry value when the ref resolves and otherwise yields the
 *   caller's embedded paint cache — matching Figma's actual rendering
 *   for dangling references.
 *
 * - `resolveNodeStyleIds` / `resolveStyleIdOnMutableNode` apply the
 *   resolved paints back onto a node — when the registry has the
 *   style it overrides the node's potentially-stale embedded cache.
 *
 * Regression guard for: Device 2×4 Apple logo (cross-canvas asset-ref
 * lookup), YouTube OFF-state chevron (FILL-style referenced via
 * `styleIdForStrokeFill`, which historically used the wrong field on
 * the style-definition node and silently reused the consumer's stale
 * stroke cache), and the E-Commerce Plant Shop Community export
 * (intra-file guid pointing at a non-style FRAME — Figma renders the
 * consumer's own fillPaints, so the resolver must not throw).
 */

import {
  buildFigStyleRegistry,
  resolveNodeStyleIds,
  resolvePaintRef,
  resolveStyledPaint,
  resolveStyledEffects,
  resolveStyledTextProperties,
  resolveStyledGrids,
  formatNodeLocator,
  styleRefHasKey,
  styleRefKey,
  styleRefKeys,
} from "./style-registry";
import { EMPTY_FIG_STYLE_REGISTRY, indexFigKiwiDocument } from "../domain";
import type { FigNode, FigPaint, FigEffect } from "../types";
import { BLEND_MODE_VALUES, EFFECT_TYPE_VALUES, PAINT_TYPE_VALUES } from "../constants";

function dropShadow(radius: number): FigEffect {
  return {
    type: { value: EFFECT_TYPE_VALUES.DROP_SHADOW, name: "DROP_SHADOW" },
    radius,
    visible: true,
    blendMode: { value: BLEND_MODE_VALUES.NORMAL, name: "NORMAL" },
  };
}

function layerBlur(radius: number): FigEffect {
  return {
    type: { value: EFFECT_TYPE_VALUES.FOREGROUND_BLUR, name: "FOREGROUND_BLUR" },
    radius,
    visible: true,
    blendMode: { value: BLEND_MODE_VALUES.NORMAL, name: "NORMAL" },
  };
}

function solidPaint(r: number, g: number, b: number): FigPaint {
  return {
    type: { value: PAINT_TYPE_VALUES.SOLID, name: "SOLID" },
    color: { r, g, b, a: 1 },
    opacity: 1,
    visible: true,
    blendMode: { value: BLEND_MODE_VALUES.NORMAL, name: "NORMAL" },
  };
}

function node(overrides: Partial<FigNode>): FigNode {
  const base: FigNode = {
    guid: { sessionID: 0, localID: 0 },
    phase: { value: 0, name: "CREATED" },
    type: { value: 3, name: "RECTANGLE" },
  };
  return {
    ...base,
    ...overrides,
  };
}

function registryFrom(nodes: readonly FigNode[]) {
  return buildFigStyleRegistry(indexFigKiwiDocument(nodes));
}

describe("styleRefKey / styleRefKeys / styleRefHasKey", () => {
  it("returns the guid string when the reference carries a guid", () => {
    expect(styleRefKey({ guid: { sessionID: 15, localID: 133 } })).toBe("15:133");
  });

  it("returns the assetRef.key when only assetRef is present", () => {
    expect(styleRefKey({ assetRef: { key: "abc123" } })).toBe("abc123");
  });

  it("prefers guid over assetRef when both are present", () => {
    expect(styleRefKey({
      guid: { sessionID: 15, localID: 133 },
      assetRef: { key: "abc123" },
    })).toBe("15:133");
  });

  it("returns both keys from styleRefKeys in preference order", () => {
    expect(styleRefKeys({
      guid: { sessionID: 15, localID: 133 },
      assetRef: { key: "abc123" },
    })).toEqual(["15:133", "abc123"]);
  });

  it("returns empty array for an undefined reference", () => {
    expect(styleRefKeys(undefined)).toEqual([]);
  });

  it("styleRefHasKey is false for empty/undefined refs and true otherwise", () => {
    expect(styleRefHasKey(undefined)).toBe(false);
    expect(styleRefHasKey({})).toBe(false);
    expect(styleRefHasKey({ assetRef: { key: "" } })).toBe(false);
    expect(styleRefHasKey({ guid: { sessionID: 1, localID: 2 } })).toBe(true);
    expect(styleRefHasKey({ assetRef: { key: "x" } })).toBe(true);
  });

  it("styleRefHasKey treats Figma's 0xffffffff:0xffffffff sentinel as no reference", () => {
    // Figma's Kiwi schema uses both-uint32-max as a "no guid" sentinel
    // inside an otherwise-present FigStyleId slot. Treat it as absent so
    // resolution falls through cleanly to inline paints / base style.
    const sentinel = { guid: { sessionID: 0xffffffff, localID: 0xffffffff } };
    expect(styleRefHasKey(sentinel)).toBe(false);
    // Mixed: sentinel guid + real assetRef.key still has the key.
    expect(styleRefHasKey({ guid: { sessionID: 0xffffffff, localID: 0xffffffff }, assetRef: { key: "x" } })).toBe(true);
  });
});

describe("buildFigStyleRegistry", () => {
  it("indexes a FILL style-definition node under its GUID using fillPaints", () => {
    const def = node({
      guid: { sessionID: 1, localID: 100 },
      styleType: { value: 1, name: "FILL" },
      fillPaints: [solidPaint(0, 0, 0)],
    });
    const registry = registryFrom([def]);
    expect(registry.paints.get("1:100")).toEqual([solidPaint(0, 0, 0)]);
  });

  it("indexes a STROKE style-definition node under its GUID using strokePaints", () => {
    const def = node({
      guid: { sessionID: 1, localID: 101 },
      styleType: { value: 2, name: "STROKE" },
      strokePaints: [solidPaint(0.5, 0.5, 0.5)],
    });
    const registry = registryFrom([def]);
    expect(registry.paints.get("1:101")).toEqual([solidPaint(0.5, 0.5, 0.5)]);
  });

  it("indexes a style-definition under both GUID and assetRef key when both are present", () => {
    const proxy = node({
      guid: { sessionID: 15, localID: 133 },
      styleType: { value: 1, name: "FILL" },
      key: "c3ebcfd9acc3408d6578662e147b484f2e0b567d",
      fillPaints: [solidPaint(0, 0, 0)],
    });
    const registry = registryFrom([proxy]);
    expect(registry.paints.get("15:133")).toEqual([solidPaint(0, 0, 0)]);
    expect(registry.paints.get("c3ebcfd9acc3408d6578662e147b484f2e0b567d"))
      .toEqual([solidPaint(0, 0, 0)]);
  });

  it("does not index nodes without styleType, even if they carry fillPaints", () => {
    // A regular RECTANGLE with fillPaints is not a style-definition.
    const rect = node({
      guid: { sessionID: 2, localID: 200 },
      fillPaints: [solidPaint(0, 0, 0)],
    });
    const registry = registryFrom([rect]);
    expect(registry.paints.size).toBe(0);
    expect(registry.effects.size).toBe(0);
    expect(registry.textProperties.size).toBe(0);
    expect(registry.layoutGrids.size).toBe(0);
  });

  it("skips style-definitions whose implied paint field is empty", () => {
    // FILL styleType but no fillPaints → cannot contribute to registry.
    const empty = node({
      guid: { sessionID: 3, localID: 300 },
      styleType: { value: 1, name: "FILL" },
      // no fillPaints
    });
    const registry = registryFrom([empty]);
    expect(registry.paints.size).toBe(0);
  });

  it("does not cross-map fillPaints to strokePaints based on consumer intent", () => {
    // A FILL style stores its paint in fillPaints. Even if a consumer
    // references it via styleIdForStrokeFill, the build-time indexing
    // uses the style's own type, not the consumer's intent. The
    // single-map SoT means both consumer intents resolve through the
    // same paint array.
    const fillStyle = node({
      guid: { sessionID: 7, localID: 80 },
      styleType: { value: 1, name: "FILL" },
      fillPaints: [solidPaint(1, 1, 1)],
    });
    const registry = registryFrom([fillStyle]);
    // Same lookup key works regardless of intent — registry is intent-agnostic.
    expect(registry.paints.get("7:80")).toEqual([solidPaint(1, 1, 1)]);
  });

  it("indexes an EFFECT style-definition node under its GUID using effects", () => {
    const blur = layerBlur(4);
    const def = node({
      guid: { sessionID: 4, localID: 1 },
      styleType: { value: 4, name: "EFFECT" },
      effects: [blur],
    });
    const registry = registryFrom([def]);
    expect(registry.effects.get("4:1")).toEqual([blur]);
    expect(registry.paints.size).toBe(0);
  });

  it("indexes a TEXT style-definition node into the textProperties map (only set fields)", () => {
    const def = node({
      guid: { sessionID: 5, localID: 1 },
      styleType: { value: 3, name: "TEXT" },
      fontSize: 24,
      lineHeight: { value: 32, units: { value: 1, name: "PIXELS" } },
      // letterSpacing intentionally omitted — the style only sets
      // fontSize and lineHeight, and the registry must reflect that
      // partial coverage so consumers keep their embedded values
      // for unset properties.
    });
    const registry = registryFrom([def]);
    const properties = registry.textProperties.get("5:1");
    expect(properties).toBeDefined();
    expect(properties?.fontSize).toBe(24);
    expect(properties?.lineHeight?.value).toBe(32);
    expect(properties?.letterSpacing).toBeUndefined();
  });

  it("indexes a GRID style-definition node into the layoutGrids map", () => {
    const grid = { type: "COLUMNS", count: 12 };
    const def = node({
      guid: { sessionID: 6, localID: 1 },
      styleType: { value: 6, name: "GRID" },
      layoutGrids: [grid],
    });
    const registry = registryFrom([def]);
    expect(registry.layoutGrids.get("6:1")).toEqual([grid]);
  });
});

describe("resolvePaintRef", () => {
  it("returns undefined for an undefined reference", () => {
    expect(resolvePaintRef(undefined, EMPTY_FIG_STYLE_REGISTRY)).toBeUndefined();
  });

  it("returns undefined for a reference with no usable key", () => {
    expect(resolvePaintRef({}, EMPTY_FIG_STYLE_REGISTRY)).toBeUndefined();
  });

  it("resolves a guid reference through the registry", () => {
    const def = node({
      guid: { sessionID: 1, localID: 100 },
      styleType: { value: 1, name: "FILL" },
      fillPaints: [solidPaint(0, 0, 0)],
    });
    const registry = registryFrom([def]);
    const resolved = resolvePaintRef(
      { guid: { sessionID: 1, localID: 100 } },
      registry,
    );
    expect(resolved).toEqual([solidPaint(0, 0, 0)]);
  });

  it("resolves the same paint via either intent (SoT regression guard for the OFF chevron)", () => {
    // FILL-type style 7:80, referenced as both fill and stroke. The
    // lookup primitive is intent-agnostic: a single registry entry
    // serves both consumer intents.
    const fillStyle = node({
      guid: { sessionID: 7, localID: 80 },
      styleType: { value: 1, name: "FILL" },
      fillPaints: [solidPaint(1, 1, 1)],
    });
    const registry = registryFrom([fillStyle]);
    const ref = { guid: { sessionID: 7, localID: 80 } };
    expect(resolvePaintRef(ref, registry)).toEqual([solidPaint(1, 1, 1)]);
  });

  it("returns undefined for a dangling reference (key carried but no registry entry)", () => {
    // Real-world case: Figma Community exports include team-library
    // refs whose proxy nodes are stripped, and intra-file guids may
    // point at non-style nodes (a stale FRAME guid). The lookup
    // primitive must yield undefined so callers fall through to the
    // consumer's embedded paint cache — what Figma itself does.
    expect(resolvePaintRef(
      { guid: { sessionID: 99, localID: 99 } },
      EMPTY_FIG_STYLE_REGISTRY,
    )).toBeUndefined();
  });
});

describe("resolveStyledPaint (registry-vs-embedded SoT)", () => {
  const registryPaint = solidPaint(1, 0, 0);
  const embeddedPaint = solidPaint(0, 0, 1);
  const styleNode = node({
    guid: { sessionID: 1, localID: 100 },
    styleType: { value: 1, name: "FILL" },
    fillPaints: [registryPaint],
  });
  const registry = registryFrom([styleNode]);

  it("returns the registry value when the ref resolves (registry wins over embedded)", () => {
    const got = resolveStyledPaint(
      { guid: { sessionID: 1, localID: 100 } },
      [embeddedPaint],
      registry,
    );
    expect(got).toEqual([registryPaint]);
  });

  it("returns the embedded value when the ref is absent", () => {
    const got = resolveStyledPaint(undefined, [embeddedPaint], registry);
    expect(got).toEqual([embeddedPaint]);
  });

  it("returns the embedded value when the ref is dangling (Plant Shop / Community export shape)", () => {
    // Consumer carries a styleId pointing at a non-style or absent
    // node, and its own embedded paint is the SoT — Figma renders
    // these with the embedded paint, so must we.
    const got = resolveStyledPaint(
      { guid: { sessionID: 99, localID: 99 } },
      [embeddedPaint],
      registry,
    );
    expect(got).toEqual([embeddedPaint]);
  });

  it("preserves an explicitly-empty embedded array (not the same as undefined)", () => {
    expect(resolveStyledPaint(undefined, [], registry)).toEqual([]);
  });

  it("returns undefined when both ref and embedded are absent", () => {
    expect(resolveStyledPaint(undefined, undefined, registry)).toBeUndefined();
  });
});

describe("resolveStyledEffects (registry-vs-embedded SoT for EFFECT styles)", () => {
  const styleEffect = dropShadow(8);
  const embeddedEffect = layerBlur(4);
  const styleNode = node({
    guid: { sessionID: 4, localID: 1 },
    styleType: { value: 4, name: "EFFECT" },
    effects: [styleEffect],
  });
  const registry = registryFrom([styleNode]);

  it("returns the registry effects when the ref resolves", () => {
    const got = resolveStyledEffects(
      { guid: { sessionID: 4, localID: 1 } },
      [embeddedEffect],
      registry,
    );
    expect(got).toEqual([styleEffect]);
  });

  it("returns the embedded effects when the ref is dangling", () => {
    const got = resolveStyledEffects(
      { guid: { sessionID: 99, localID: 99 } },
      [embeddedEffect],
      registry,
    );
    expect(got).toEqual([embeddedEffect]);
  });

  it("returns the embedded effects when the ref is absent", () => {
    expect(resolveStyledEffects(undefined, [embeddedEffect], registry)).toEqual([embeddedEffect]);
  });
});

describe("resolveStyledTextProperties (per-property registry overlay)", () => {
  const partialTextStyle = node({
    guid: { sessionID: 5, localID: 1 },
    styleType: { value: 3, name: "TEXT" },
    fontSize: 24,
    lineHeight: { value: 32, units: { value: 1, name: "PIXELS" } },
  });
  const registry = registryFrom([partialTextStyle]);

  it("overrides only the properties the style sets, leaving others embedded", () => {
    const got = resolveStyledTextProperties(
      { guid: { sessionID: 5, localID: 1 } },
      {
        fontName: { family: "Inter", style: "Regular" },
        fontSize: 12,
        letterSpacing: { value: 0.5, units: { value: 1, name: "PIXELS" } },
      },
      registry,
    );
    // fontSize and lineHeight come from the style; the rest from
    // embedded. This is how Figma applies a partial text style.
    expect(got.fontSize).toBe(24);
    expect(got.lineHeight?.value).toBe(32);
    expect(got.fontName).toEqual({ family: "Inter", style: "Regular" });
    expect(got.letterSpacing?.value).toBe(0.5);
  });

  it("returns the embedded bundle unchanged when the ref is dangling", () => {
    const embedded = {
      fontName: { family: "Inter", style: "Bold" },
      fontSize: 14,
    };
    const got = resolveStyledTextProperties(
      { guid: { sessionID: 99, localID: 99 } },
      embedded,
      registry,
    );
    expect(got).toBe(embedded);
  });

  it("returns the embedded bundle unchanged when the ref is absent", () => {
    const embedded = { fontSize: 16 };
    expect(resolveStyledTextProperties(undefined, embedded, registry)).toBe(embedded);
  });
});

describe("resolveStyledGrids (registry-vs-embedded SoT for GRID styles)", () => {
  const styleGrid = { type: "COLUMNS", count: 12 };
  const embeddedGrid = { type: "ROWS", count: 4 };
  const styleNode = node({
    guid: { sessionID: 6, localID: 1 },
    styleType: { value: 6, name: "GRID" },
    layoutGrids: [styleGrid],
  });
  const registry = registryFrom([styleNode]);

  it("returns the registry grids when the ref resolves", () => {
    const got = resolveStyledGrids(
      { guid: { sessionID: 6, localID: 1 } },
      [embeddedGrid],
      registry,
    );
    expect(got).toEqual([styleGrid]);
  });

  it("returns the embedded grids when the ref is dangling", () => {
    const got = resolveStyledGrids(
      { guid: { sessionID: 99, localID: 99 } },
      [embeddedGrid],
      registry,
    );
    expect(got).toEqual([embeddedGrid]);
  });
});

describe("resolveNodeStyleIds extended StyleType coverage", () => {
  it("bakes a TEXT style's properties into a consumer's text fields", () => {
    const styleDef = node({
      guid: { sessionID: 5, localID: 1 },
      styleType: { value: 3, name: "TEXT" },
      fontSize: 24,
      lineHeight: { value: 32, units: { value: 1, name: "PIXELS" } },
    });
    const consumer = node({
      guid: { sessionID: 9, localID: 1 },
      type: { value: 5, name: "TEXT" },
      styleIdForText: { guid: { sessionID: 5, localID: 1 } },
      fontSize: 12,
      letterSpacing: { value: 0.5, units: { value: 1, name: "PIXELS" } },
    });
    const registry = registryFrom([styleDef, consumer]);
    const resolved = resolveNodeStyleIds(consumer, registry);
    expect(resolved.fontSize).toBe(24);
    expect(resolved.lineHeight?.value).toBe(32);
    // letterSpacing isn't set on the style, so the consumer's value
    // survives.
    expect(resolved.letterSpacing?.value).toBe(0.5);
  });

  it("bakes an EFFECT style's effects into a consumer's effects field", () => {
    const styleEffect = dropShadow(8);
    const styleDef = node({
      guid: { sessionID: 4, localID: 1 },
      styleType: { value: 4, name: "EFFECT" },
      effects: [styleEffect],
    });
    const consumer = node({
      guid: { sessionID: 9, localID: 2 },
      styleIdForEffect: { guid: { sessionID: 4, localID: 1 } },
      effects: [],
    });
    const registry = registryFrom([styleDef, consumer]);
    const resolved = resolveNodeStyleIds(consumer, registry);
    expect(resolved.effects).toEqual([styleEffect]);
  });

  it("leaves the consumer's effects in place when styleIdForEffect is dangling", () => {
    const embedded = [layerBlur(4)];
    const consumer = node({
      guid: { sessionID: 9, localID: 3 },
      styleIdForEffect: { guid: { sessionID: 99, localID: 99 } },
      effects: embedded,
    });
    const resolved = resolveNodeStyleIds(consumer, EMPTY_FIG_STYLE_REGISTRY);
    expect(resolved).toBe(consumer);
    expect(resolved.effects).toBe(embedded);
  });
});

describe("resolveNodeStyleIds", () => {
  it("replaces a consumer node's fillPaints using an assetRef.key lookup", () => {
    const proxy = node({
      guid: { sessionID: 15, localID: 133 },
      styleType: { value: 1, name: "FILL" },
      key: "blackkey",
      fillPaints: [solidPaint(0, 0, 0)],
    });
    const consumer = node({
      guid: { sessionID: 15, localID: 500 },
      styleIdForFill: { assetRef: { key: "blackkey" } },
      fillPaints: [solidPaint(1, 1, 1)],
    });
    const registry = registryFrom([proxy, consumer]);

    const resolved = resolveNodeStyleIds(consumer, registry);
    expect(resolved.fillPaints?.[0]).toMatchObject({
      color: { r: 0, g: 0, b: 0, a: 1 },
    });
  });

  it("leaves the consumer's embedded fillPaints in place when the styleIdForFill is dangling", () => {
    // A dangling ref is a normal Figma Community-export shape; the
    // node's own fillPaints is the SoT in that case (Figma itself
    // renders the embedded paint). The resolver must not rewrite the
    // embedded cache, and must not throw.
    const embedded = [solidPaint(1, 1, 1)] as const;
    const consumer = node({
      guid: { sessionID: 15, localID: 500 },
      name: "Consumer",
      styleIdForFill: { assetRef: { key: "no-such-key" } },
      fillPaints: embedded,
    });
    const result = resolveNodeStyleIds(consumer, EMPTY_FIG_STYLE_REGISTRY);
    expect(result).toBe(consumer);
    expect(result.fillPaints).toBe(embedded);
  });

  it("returns the node unchanged when no style references are present", () => {
    const consumer = node({
      guid: { sessionID: 15, localID: 501 },
      fillPaints: [solidPaint(1, 1, 1)],
    });
    expect(resolveNodeStyleIds(consumer, EMPTY_FIG_STYLE_REGISTRY)).toBe(consumer);
  });
});

describe("formatNodeLocator", () => {
  it("formats a node with guid and name", () => {
    expect(formatNodeLocator({
      guid: { sessionID: 34, localID: 785 },
      name: "Vector",
    })).toBe("34:785 (Vector)");
  });

  it("falls back to <no-guid> and ? for missing fields", () => {
    expect(formatNodeLocator({})).toBe("<no-guid> (?)");
  });
});
