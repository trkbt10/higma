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
 *   consumer (node fill/stroke, scene-graph instance merge, vector
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
 * the style-definition node and silently fell back to the consumer's
 * stale stroke cache), and the E-Commerce Plant Shop Community export
 * (intra-file guid pointing at a non-style FRAME — Figma renders the
 * consumer's own fillPaints, so the resolver must not throw).
 */

import {
  buildFigStyleRegistry,
  resolveNodeStyleIds,
  resolvePaintRef,
  resolveStyledPaint,
  formatNodeLocator,
  styleRefHasKey,
  styleRefKey,
  styleRefKeys,
} from "./style-registry";
import { EMPTY_FIG_STYLE_REGISTRY } from "../domain/document";
import type { FigNode, FigPaint } from "../types";

function solidPaint(r: number, g: number, b: number): FigPaint {
  return {
    type: "SOLID",
    color: { r, g, b, a: 1 },
    opacity: 1,
    visible: true,
    blendMode: "NORMAL",
  };
}

function node(overrides: Partial<FigNode>): FigNode {
  return {
    guid: { sessionID: 0, localID: 0 },
    phase: { value: 0, name: "CREATED" },
    type: { value: 3, name: "RECTANGLE" },
    ...overrides,
  } as FigNode;
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
    const registry = buildFigStyleRegistry(new Map([["1:100", def]]));
    expect(registry.get("1:100")).toEqual([solidPaint(0, 0, 0)]);
  });

  it("indexes a STROKE style-definition node under its GUID using strokePaints", () => {
    const def = node({
      guid: { sessionID: 1, localID: 101 },
      styleType: { value: 2, name: "STROKE" },
      strokePaints: [solidPaint(0.5, 0.5, 0.5)],
    });
    const registry = buildFigStyleRegistry(new Map([["1:101", def]]));
    expect(registry.get("1:101")).toEqual([solidPaint(0.5, 0.5, 0.5)]);
  });

  it("indexes a style-definition under both GUID and assetRef key when both are present", () => {
    const proxy = node({
      guid: { sessionID: 15, localID: 133 },
      styleType: { value: 1, name: "FILL" },
      key: "c3ebcfd9acc3408d6578662e147b484f2e0b567d",
      fillPaints: [solidPaint(0, 0, 0)],
    });
    const registry = buildFigStyleRegistry(new Map([["15:133", proxy]]));
    expect(registry.get("15:133")).toEqual([solidPaint(0, 0, 0)]);
    expect(registry.get("c3ebcfd9acc3408d6578662e147b484f2e0b567d"))
      .toEqual([solidPaint(0, 0, 0)]);
  });

  it("does not index nodes without styleType, even if they carry fillPaints", () => {
    // A regular RECTANGLE with fillPaints is not a style-definition.
    const rect = node({
      guid: { sessionID: 2, localID: 200 },
      fillPaints: [solidPaint(0, 0, 0)],
    });
    const registry = buildFigStyleRegistry(new Map([["2:200", rect]]));
    expect(registry.size).toBe(0);
  });

  it("skips style-definitions whose implied paint field is empty", () => {
    // FILL styleType but no fillPaints → cannot contribute to registry.
    const empty = node({
      guid: { sessionID: 3, localID: 300 },
      styleType: { value: 1, name: "FILL" },
      // no fillPaints
    });
    const registry = buildFigStyleRegistry(new Map([["3:300", empty]]));
    expect(registry.size).toBe(0);
  });

  it("does not cross-fall back fillPaints to strokePaints based on consumer intent", () => {
    // A FILL style stores its paint in fillPaints. Even if a consumer
    // references it via styleIdForStrokeFill, the build-time indexing
    // uses the style's own type, not the consumer's intent. The
    // single-map SoT means both consumer intents resolve through the
    // same paint array — no fallback needed at build time.
    const fillStyle = node({
      guid: { sessionID: 7, localID: 80 },
      styleType: { value: 1, name: "FILL" },
      fillPaints: [solidPaint(1, 1, 1)],
    });
    const registry = buildFigStyleRegistry(new Map([["7:80", fillStyle]]));
    // Same lookup key works regardless of intent — registry is intent-agnostic.
    expect(registry.get("7:80")).toEqual([solidPaint(1, 1, 1)]);
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
    const registry = buildFigStyleRegistry(new Map([["1:100", def]]));
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
    const registry = buildFigStyleRegistry(new Map([["7:80", fillStyle]]));
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
  const registry = buildFigStyleRegistry(new Map([["1:100", styleNode]]));

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
    const registry = buildFigStyleRegistry(new Map([
      ["15:133", proxy],
      ["15:500", consumer],
    ]));

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
