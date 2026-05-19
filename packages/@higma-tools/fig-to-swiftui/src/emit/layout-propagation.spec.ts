/**
 * @file Locks in the SwiftUI layout-propagation contract.
 *
 * Each test asserts the EXACT modifier ordering the emit produces
 * for one fig topology, plus a comment explaining why that order
 * matches Figma's layout semantics. This is the spec for how
 * Figma layout intent maps to SwiftUI's layout pipeline:
 *
 *   • `.padding()` → `.frame(w, h, alignment:)` — Figma's frame
 *     `width × height` IS the outer size (including padding); the
 *     `.frame(...)` clamps the padded contents to the authored
 *     extent. Inverting the order would push padding outside the
 *     authored size and inflate the parent's intrinsic.
 *   • Inner shadow overlays sit BEFORE clipShape so the masked-
 *     stroke trick paints inside the visible foreground area
 *     before the clip cuts the rest.
 *   • `.clipShape(<silhouette>)` runs BEFORE `.background(...)`
 *     so the bg paints behind the clipped foreground without
 *     itself being clipped — the bg shape's own `.shadow(...)`
 *     extends OUTSIDE the silhouette unimpeded.
 *   • Drop shadow is baked into the background shape (`.background(
 *     <shape>().fill(...).shadow(...))`) so the shadow follows the
 *     silhouette rather than the foreground+bg union.
 *   • `.compositingGroup()` precedes `.opacity()` ONLY for
 *     multi-child containers so overlapping translucent siblings
 *     blend as one group rather than additively per-child.
 *
 * Adding a new modifier? Add a test here that captures the exact
 * position in the chain. Reordering an existing modifier? Update
 * the test FIRST so the regression cause is explicit.
 */
import type { FigEffect, FigGradientPaint, FigNode, FigPaint, KiwiEnumValue } from "@higma-document-models/fig/types";
import {
  EFFECT_TYPE_VALUES,
  PAINT_TYPE_VALUES,
  STROKE_ALIGN_VALUES,
} from "@higma-document-models/fig/constants";
import { serialize, type SwiftView } from "../swift-tree";
import { emitNode as emitNodeWithContext, type EmitContext } from "./walk";

function enumName<T extends string>(name: T): KiwiEnumValue<T> {
  return { value: 0, name } as KiwiEnumValue<T>;
}

function solidPaint(
  color: { readonly r: number; readonly g: number; readonly b: number; readonly a: number },
  fields: Partial<Pick<FigPaint, "opacity" | "visible" | "blendMode">> = {},
): FigPaint {
  return { type: { value: PAINT_TYPE_VALUES.SOLID, name: "SOLID" }, color, ...fields };
}

function linearGradientPaint(
  fields: Omit<FigGradientPaint, "type">,
): FigGradientPaint {
  return { type: { value: PAINT_TYPE_VALUES.GRADIENT_LINEAR, name: "GRADIENT_LINEAR" }, ...fields };
}

function dropShadow(fields: Omit<FigEffect, "type">): FigEffect {
  return { type: { value: EFFECT_TYPE_VALUES.DROP_SHADOW, name: "DROP_SHADOW" }, ...fields };
}

const INSIDE_STROKE = { value: STROKE_ALIGN_VALUES.INSIDE, name: "INSIDE" } as const;

function fixtureChildrenOf(parent: FigNode): readonly FigNode[] {
  const children: FigNode[] = [];
  for (const child of parent.children ?? []) {
    if (child === undefined || child === null) {
      throw new Error("fixtureChildrenOf: fixture contains an empty child slot");
    }
    children.push(child);
  }
  return children;
}

function emitNode(node: FigNode, ctx: EmitContext = {}): SwiftView {
  return emitNodeWithContext(node, { ...ctx, childrenOf: fixtureChildrenOf });
}

function rect(partial: Partial<FigNode> = {}): FigNode {
  return {
    guid: { sessionID: 1, localID: 1 },
    phase: enumName("CREATED"),
    type: enumName("RECTANGLE"),
    ...partial,
  } as FigNode;
}

function frame(partial: Partial<FigNode> = {}): FigNode {
  return {
    guid: { sessionID: 1, localID: 1 },
    phase: enumName("CREATED"),
    type: enumName("FRAME"),
    ...partial,
  } as FigNode;
}

describe("shape-leaf modifier order", () => {
  it("orders fill → strokeOverlay → frame → shadow → opacity → rotation", () => {
    const node = rect({
      size: { x: 100, y: 50 },
      cornerRadius: 8,
      fillPaints: [solidPaint({ r: 1, g: 0, b: 0, a: 1 })],
      strokePaints: [solidPaint({ r: 0, g: 0, b: 0, a: 1 })],
      strokeWeight: 2,
      strokeAlign: INSIDE_STROKE,
      effects: [
        dropShadow({
          radius: 4,
          offset: { x: 0, y: 2 },
          color: { r: 0, g: 0, b: 0, a: 0.3 },
          visible: true,
        }),
      ],
      opacity: 0.9,
    });
    const src = serialize(emitNode(node));
    // The shape (RoundedRectangle since cornerRadius>0) is the leaf;
    // modifiers chain off the leaf in this canonical order.
    expect(src).toMatch(/RoundedRectangle\(cornerRadius: 8\)/);
    // Fill comes first — it picks up the topmost SOLID paint.
    expect(src.indexOf(".fill")).toBeLessThan(src.indexOf(".overlay"));
    // strokeOverlay sits between fill and frame so the stroke
    // paints on the same silhouette before frame clamps the size.
    expect(src.indexOf(".overlay")).toBeLessThan(src.indexOf(".frame"));
    // Shadow sits AFTER frame — without a real frame extent, the
    // shadow has nothing to cast off (SwiftUI shadows operate on
    // the upstream view's alpha mask).
    expect(src.indexOf(".frame")).toBeLessThan(src.indexOf(".shadow"));
    // Opacity is global — last in the chain so it attenuates the
    // composited (fill + stroke + shadow) result, not just the
    // raw fill.
    expect(src.indexOf(".shadow")).toBeLessThan(src.indexOf(".opacity"));
  });
});

describe("container modifier order — non-autolayout (ZStack)", () => {
  it("padding → frame → clipShape → background → cornerRadius for plain frame", () => {
    const node = frame({
      size: { x: 200, y: 100 },
      fillPaints: [solidPaint({ r: 0.5, g: 0.5, b: 0.5, a: 1 })],
      cornerRadius: 12,
      stackPadding: 8,
      children: [],
    });
    const src = serialize(emitNode(node));
    // The container paints in this order: padding insets the
    // children, frame clamps the outer bounds, clipShape rounds
    // the silhouette for children, then background fills behind.
    const iPad = src.indexOf(".padding");
    const iFrame = src.indexOf(".frame");
    const iClip = src.indexOf(".clipShape");
    const iBg = src.indexOf(".background");
    expect(iPad).toBeGreaterThan(0);
    expect(iPad).toBeLessThan(iFrame);
    expect(iFrame).toBeLessThan(iClip);
    expect(iClip).toBeLessThan(iBg);
  });

  it("clipShape before background lets bg paint without being clipped", () => {
    // Specifically: the foreground (children) is clipped to the
    // silhouette, but `.background(...)` is appended AFTER
    // `.clipShape(...)` so the bg paints behind without itself
    // being clipped — this is the contract that lets the bg
    // shape's `.shadow(...)` extend outside the silhouette.
    const node = frame({
      size: { x: 100, y: 100 },
      fillPaints: [solidPaint({ r: 1, g: 0, b: 0, a: 1 })],
      effects: [
        dropShadow({ radius: 8, offset: { x: 0, y: 4 }, color: { r: 0, g: 0, b: 0, a: 0.3 }, visible: true }),
      ],
      children: [],
    });
    const src = serialize(emitNode(node));
    expect(src.indexOf(".clipShape")).toBeLessThan(src.indexOf(".background"));
  });

  it("baked-in drop shadow lives inside the .background argument", () => {
    // Translucent fills under a `.shadow()` would leak the shadow
    // through the fill. Baking the shadow into the bg shape
    // (`.background(<shape>().fill(...).shadow(...))`) confines the
    // shadow to outside-of-silhouette only.
    const node = frame({
      size: { x: 100, y: 100 },
      fillPaints: [solidPaint({ r: 1, g: 1, b: 1, a: 0.7 })],
      cornerRadius: 8,
      effects: [
        dropShadow({ radius: 6, offset: { x: 0, y: 3 }, color: { r: 0, g: 0, b: 0, a: 0.4 }, visible: true }),
      ],
      children: [],
    });
    const src = serialize(emitNode(node));
    // The shadow appears WITHIN the background argument, not
    // chained directly after the outer view.
    expect(src).toContain(".background(RoundedRectangle(cornerRadius: 8)");
    expect(src).toContain(".shadow(");
    // No outer-chain `.shadow(...)` after `.background(...)`. We
    // detect that by checking the only `.shadow(` lands inside
    // the `.background(...)` argument (i.e., after `.background(`
    // but before the matching `))`).
    const bgStart = src.indexOf(".background(");
    const shadowAt = src.indexOf(".shadow(");
    expect(shadowAt).toBeGreaterThan(bgStart);
    // No shadow appears outside the .background expression.
    const lastShadowAt = src.lastIndexOf(".shadow(");
    expect(lastShadowAt).toBe(shadowAt);
  });

  it("compositingGroup precedes opacity only for multi-child containers", () => {
    const child1 = rect({
      guid: { sessionID: 1, localID: 2 },
      size: { x: 50, y: 50 },
      fillPaints: [solidPaint({ r: 1, g: 0, b: 0, a: 1 })],
    });
    const child2 = rect({
      guid: { sessionID: 1, localID: 3 },
      size: { x: 50, y: 50 },
      fillPaints: [solidPaint({ r: 0, g: 1, b: 0, a: 1 })],
    });
    const multi = frame({
      size: { x: 100, y: 100 },
      opacity: 0.5,
      children: [child1, child2],
    });
    const single = frame({
      size: { x: 100, y: 100 },
      opacity: 0.5,
      children: [child1],
    });
    const multiSrc = serialize(emitNode(multi));
    const singleSrc = serialize(emitNode(single));
    expect(multiSrc).toContain(".compositingGroup()");
    expect(multiSrc.indexOf(".compositingGroup")).toBeLessThan(multiSrc.indexOf(".opacity"));
    expect(singleSrc).not.toContain(".compositingGroup()");
    expect(singleSrc).toContain(".opacity(0.5)");
  });
});

describe("frame clip propagation", () => {
  it("clip applies to FRAME but not to GROUP", () => {
    // FRAME nodes clip their content by default in Figma; GROUP
    // nodes are transparent passthrough. The emit reflects that:
    // FRAME gets `.clipShape(...)`, GROUP doesn't.
    const fnode = frame({
      size: { x: 100, y: 100 },
      fillPaints: [solidPaint({ r: 1, g: 1, b: 1, a: 1 })],
      children: [],
    });
    const gnode: FigNode = {
      ...fnode,
      type: enumName("GROUP"),
      // Strip the fill so the group looks like a real group.
      fillPaints: undefined,
    } as FigNode;
    const fsrc = serialize(emitNode(fnode));
    const gsrc = serialize(emitNode(gnode));
    expect(fsrc).toContain(".clipShape(");
    expect(gsrc).not.toContain(".clipShape(");
  });

  it("clip is suppressed when frameMaskDisabled is true", () => {
    // Figma's escape hatch: `frameMaskDisabled = true` turns the
    // frame into a non-clipping container while keeping its other
    // FRAME-like behaviour (autolayout, padding, etc.).
    const node = frame({
      size: { x: 100, y: 100 },
      fillPaints: [solidPaint({ r: 1, g: 1, b: 1, a: 1 })],
      frameMaskDisabled: true,
      children: [],
    });
    const src = serialize(emitNode(node));
    expect(src).not.toContain(".clipShape(");
  });

  it("clip uses RoundedRectangle when the frame has a corner radius", () => {
    const node = frame({
      size: { x: 100, y: 100 },
      cornerRadius: 16,
      fillPaints: [solidPaint({ r: 1, g: 1, b: 1, a: 1 })],
      children: [],
    });
    const src = serialize(emitNode(node));
    expect(src).toContain(".clipShape(RoundedRectangle(cornerRadius: 16))");
  });
});

describe("ZStack absolute children carry their own offset", () => {
  it("emits .offset(x, y) per child from transform.m02/m12", () => {
    const child = rect({
      guid: { sessionID: 1, localID: 2 },
      size: { x: 30, y: 30 },
      fillPaints: [solidPaint({ r: 1, g: 0, b: 0, a: 1 })],
      transform: { m00: 1, m01: 0, m02: 12, m10: 0, m11: 1, m12: 8 },
    });
    const node = frame({
      size: { x: 100, y: 100 },
      children: [child],
    });
    const src = serialize(emitNode(node));
    // Child's offset reflects the Figma transform translation.
    expect(src).toContain(".offset(x: 12, y: 8)");
    // Parent ZStack uses topLeading so absolute offsets resolve
    // against the frame's top-left.
    expect(src).toContain("ZStack(alignment: .topLeading)");
  });
});

describe("HStack vs VStack sets primary axis correctly", () => {
  // The frameModifier uses the alignment computed from the layout
  // plan. For HStack the primary axis is horizontal; for VStack
  // it's vertical. The chosen frameAlignment must reflect both
  // primary distribution AND counter-axis alignment.
  it("HStack with primary=center counter=top emits frame alignment .top", () => {
    const child = rect({
      guid: { sessionID: 1, localID: 2 },
      size: { x: 30, y: 30 },
      fillPaints: [solidPaint({ r: 1, g: 0, b: 0, a: 1 })],
    });
    const node = frame({
      size: { x: 200, y: 60 },
      stackMode: enumName("HORIZONTAL"),
      stackPrimaryAlignItems: enumName("CENTER"),
      stackCounterAlignItems: enumName("MIN"),
      children: [child],
    });
    const src = serialize(emitNode(node));
    // HStack itself uses .top (counter alignment)
    expect(src).toContain("HStack(alignment: .top");
    // The outer .frame uses the same .top alignment so the HStack
    // hugs the top edge of the frame's vertical extent.
    expect(src).toMatch(/\.frame\(width: 200, height: 60, alignment: \.top\)/);
  });

  it("VStack with primary=center counter=trailing emits frame alignment .trailing", () => {
    const child = rect({
      guid: { sessionID: 1, localID: 2 },
      size: { x: 30, y: 30 },
      fillPaints: [solidPaint({ r: 1, g: 0, b: 0, a: 1 })],
    });
    const node = frame({
      size: { x: 100, y: 200 },
      stackMode: enumName("VERTICAL"),
      stackPrimaryAlignItems: enumName("CENTER"),
      stackCounterAlignItems: enumName("MAX"),
      children: [child],
    });
    const src = serialize(emitNode(node));
    expect(src).toContain("VStack(alignment: .trailing");
    expect(src).toMatch(/\.frame\(width: 100, height: 200, alignment: \.trailing\)/);
  });
});

describe("autolayout HStack child sizing", () => {
  // Figma autolayout's HStack drives children with `stackChildPrimaryGrow`
  // (= layoutGrow=1) by replacing the child's `.frame(width:, height:)`
  // with `.frame(maxWidth: .infinity, height:)` so the child fills
  // remaining primary-axis space. The cross-axis stays at the
  // authored height. STRETCH on counter-axis goes the other way.
  it("converts stackChildPrimaryGrow=1 child to .frame(maxWidth: .infinity)", () => {
    const child = rect({
      guid: { sessionID: 1, localID: 2 },
      size: { x: 100, y: 40 },
      fillPaints: [solidPaint({ r: 1, g: 0, b: 0, a: 1 })],
      stackChildPrimaryGrow: 1,
    });
    const node = frame({
      size: { x: 320, y: 60 },
      stackMode: enumName("HORIZONTAL"),
      children: [child],
    });
    const src = serialize(emitNode(node));
    expect(src).toContain("maxWidth: .infinity");
    // Counter-axis (height) stays fixed at the child's authored size.
    expect(src).toContain("maxHeight: 40");
  });

  it("STRETCH counter-axis on a child also produces .frame(maxHeight: .infinity)", () => {
    const child: FigNode = {
      ...rect({
        guid: { sessionID: 1, localID: 2 },
        size: { x: 50, y: 30 },
        fillPaints: [solidPaint({ r: 0, g: 1, b: 0, a: 1 })],
      }),
      stackChildAlignSelf: enumName("STRETCH"),
    } as FigNode;
    const node = frame({
      size: { x: 200, y: 80 },
      stackMode: enumName("HORIZONTAL"),
      children: [child],
    });
    const src = serialize(emitNode(node));
    expect(src).toContain("maxHeight: .infinity");
  });
});

describe("padding ordering vs frame", () => {
  // Figma authored size includes padding. SwiftUI's
  // `.padding(p).frame(w, h)` clamps the padded children to w×h,
  // matching that semantic exactly. Reversing the order
  // (`.frame(w, h).padding(p)`) would push padding OUTSIDE the
  // authored size and inflate the parent's intrinsic.
  it("emits .padding before .frame", () => {
    const node = frame({
      size: { x: 200, y: 80 },
      stackMode: enumName("HORIZONTAL"),
      stackPadding: 12,
      children: [],
    });
    const src = serialize(emitNode(node));
    const iPad = src.indexOf(".padding(12)");
    const iFrame = src.indexOf(".frame(width: 200");
    expect(iPad).toBeGreaterThan(0);
    expect(iFrame).toBeGreaterThan(iPad);
  });

  it("non-uniform padding emits .padding(EdgeInsets) form", () => {
    // Figma's Kiwi schema only exposes per-side overrides for
    // RIGHT and BOTTOM; TOP and LEFT come from the legacy
    // `stackVerticalPadding` / `stackHorizontalPadding` shorthand
    // (see `extractAutoLayout` in @higma-document-models/fig
    // domain-conversion). When a real fig file authors
    // `vertical=4, horizontal=12, right=16, bottom=8` we expect the
    // emit to land all four sides correctly.
    const node = frame({
      size: { x: 200, y: 80 },
      stackVerticalPadding: 4,
      stackHorizontalPadding: 12,
      stackPaddingBottom: 8,
      stackPaddingRight: 16,
      stackMode: enumName("HORIZONTAL"),
      children: [],
    });
    const src = serialize(emitNode(node));
    expect(src).toContain("EdgeInsets(top: 4, leading: 12, bottom: 8, trailing: 16)");
  });
});

describe("ZStack alignment vs .frame alignment", () => {
  // Non-autolayout containers (ZStack) use alignment .topLeading
  // both at the stack level (so child views with .offset(x, y)
  // align against the top-left) and at the .frame level (so the
  // ZStack's intrinsic content sits at the frame's top-left when
  // the frame is larger than intrinsic).
  it("ZStack and outer frame both use .topLeading", () => {
    const child = rect({
      guid: { sessionID: 1, localID: 2 },
      size: { x: 30, y: 30 },
      fillPaints: [solidPaint({ r: 1, g: 0, b: 0, a: 1 })],
    });
    const node = frame({ size: { x: 200, y: 100 }, children: [child] });
    const src = serialize(emitNode(node));
    expect(src).toContain("ZStack(alignment: .topLeading)");
    expect(src).toContain("alignment: .topLeading");
  });
});

describe("fixed-size primitives don't grow with parent", () => {
  // RECTANGLE leaves emit `.frame(width: w, height: h, alignment:
  // .topLeading)` which fixes their size regardless of parent's
  // layout. Without this, SwiftUI's `Rectangle()` would grow to
  // fill available space and break Figma's authored sizing.
  it("RECTANGLE has explicit frame at authored size", () => {
    const node = rect({
      size: { x: 64, y: 32 },
      fillPaints: [solidPaint({ r: 1, g: 1, b: 1, a: 1 })],
    });
    const src = serialize(emitNode(node));
    expect(src).toContain(".frame(width: 64, height: 32, alignment: .topLeading)");
  });
});

describe("multi-paint fills", () => {
  // Figma renders paints back-to-front; the topmost (last visible)
  // wins as the primary `.fill(...)`, with under-paints layered as
  // `.background(<shape>().fill(<paint>))` overlays. Without the
  // ordering, a SOLID-on-top-of-GRADIENT stack would collapse to
  // SOLID-only.
  it("emits topmost paint as .fill and the rest as background overlays", () => {
    const node = rect({
      size: { x: 100, y: 100 },
      fillPaints: [
        solidPaint({ r: 1, g: 0, b: 0, a: 1 }, { visible: true }),
        linearGradientPaint({
          stops: [
            { position: 0, color: { r: 0, g: 0, b: 1, a: 1 } },
            { position: 1, color: { r: 0, g: 1, b: 0, a: 1 } },
          ],
          transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        }),
      ],
    });
    const src = serialize(emitNode(node));
    // Topmost (gradient) is the .fill.
    expect(src).toContain(".fill(LinearGradient");
    // SOLID red is layered behind via .background.
    expect(src).toContain(".background");
    expect(src).toContain("Color(red: 1, green: 0, blue: 0)");
  });
});

describe("background silhouette tracks the foreground clip", () => {
  // The container chain applies `.clipShape(<silhouette>())` BEFORE
  // `.background(...)`. SwiftUI's `.background(_)` paints behind the
  // upstream view but is itself NOT clipped by an earlier
  // `.clipShape(...)` — so a bare `.background(<color>)` would paint
  // a sharp rectangle that pokes past the rounded foreground at the
  // corners, producing visible corner artifacts.
  //
  // The fix wraps the background paint in `<shape>().fill(<paint>)`
  // so the bg silhouette matches the foreground clip silhouette.
  // For cornerRadius>0 frames, both use the same RoundedRectangle.
  it("rounded frame: background uses RoundedRectangle silhouette", () => {
    const node = frame({
      size: { x: 120, y: 44 },
      cornerRadius: 12,
      fillPaints: [solidPaint({ r: 0, g: 0.478, b: 1, a: 1 })],
      children: [],
    });
    const src = serialize(emitNode(node));
    // Foreground clip uses RoundedRectangle(cornerRadius: 12).
    expect(src).toContain(".clipShape(RoundedRectangle(cornerRadius: 12))");
    // Background also uses RoundedRectangle(cornerRadius: 12) so
    // the two silhouettes match — no corner leak.
    expect(src).toContain(".background(RoundedRectangle(cornerRadius: 12)");
    expect(src).toContain(".fill(Color");
  });

  it("non-rounded frame: background uses Rectangle silhouette", () => {
    const node = frame({
      size: { x: 100, y: 50 },
      fillPaints: [solidPaint({ r: 1, g: 1, b: 1, a: 1 })],
      children: [],
    });
    const src = serialize(emitNode(node));
    expect(src).toContain(".clipShape(Rectangle())");
    expect(src).toContain(".background(Rectangle()");
  });
});

describe("rasterized subtree short-circuit", () => {
  // When `EmitContext.rasterizedSubtrees` lists the node's guid,
  // the emitter must STOP recursing and emit a single
  // `Image("<slug>", bundle: .module).resizable().frame(w, h)`
  // leaf instead of the original SwiftUI subtree. This is the
  // sole mechanism that lets path-heavy figures escape SwiftUI's
  // body-type-check explosion.
  it("emits Image(slug, bundle: .module).resizable().frame(w, h) for a rasterized node", () => {
    const node = rect({
      guid: { sessionID: 1, localID: 42 },
      size: { x: 120, y: 180 },
      // Loud fill that the rasterized leaf MUST NOT show — if the
      // emit accidentally recurses, the SOLID red would still
      // appear in the output.
      fillPaints: [solidPaint({ r: 1, g: 0, b: 0, a: 1 })],
    });
    const map = new Map<string, string>([["1:42", "card-of-spades"]]);
    const src = serialize(emitNode(node, { rasterizedSubtrees: map }));
    expect(src).toContain('Image("card-of-spades", bundle: .module)');
    expect(src).toContain(".resizable()");
    expect(src).toContain(".frame(width: 120, height: 180, alignment: .topLeading)");
    // The original `.fill(...)` must NOT appear — the subtree
    // was replaced wholesale.
    expect(src).not.toContain("Color(red: 1, green: 0, blue: 0)");
  });

  it("falls through normally when the node is not in the rasterized map", () => {
    const node = rect({
      guid: { sessionID: 1, localID: 42 },
      size: { x: 50, y: 30 },
      fillPaints: [solidPaint({ r: 0, g: 1, b: 0, a: 1 })],
    });
    const map = new Map<string, string>([["999:0", "unrelated"]]);
    const src = serialize(emitNode(node, { rasterizedSubtrees: map }));
    expect(src).not.toContain("Image(");
    expect(src).toContain("Color(red: 0, green: 1, blue: 0)");
  });

  it("does not short-circuit rasterized children when the parent is alive", () => {
    // A FRAME containing a rasterized leaf still emits the FRAME
    // structurally — only the leaf is replaced by an Image. This
    // lets the surrounding SwiftUI layout (HStack/VStack/ZStack
    // composition, padding, etc.) keep doing its job around the
    // rasterized region.
    const child = rect({
      guid: { sessionID: 1, localID: 100 },
      size: { x: 30, y: 30 },
      fillPaints: [solidPaint({ r: 1, g: 0, b: 0, a: 1 })],
    });
    const parent = frame({
      guid: { sessionID: 1, localID: 1 },
      size: { x: 200, y: 200 },
      children: [child],
    });
    const map = new Map<string, string>([["1:100", "tile"]]);
    const src = serialize(emitNode(parent, { rasterizedSubtrees: map }));
    // Parent still renders as ZStack (FRAME)
    expect(src).toContain("ZStack(alignment: .topLeading)");
    // Child is the rasterized Image
    expect(src).toContain('Image("tile", bundle: .module)');
    // No remnants of the child's original fill.
    expect(src).not.toContain("Color(red: 1, green: 0, blue: 0)");
  });
});

describe("rotation applies anchor: topLeading + offset placement", () => {
  it("emits rotationEffect(.degrees(d), anchor: .topLeading) before placement offset", () => {
    // Figma's transform rotates around the node's own top-left,
    // then translates by (m02, m12). The emit pins the SwiftUI
    // anchor to .topLeading so the subsequent `.offset(x, y)`
    // (set by the parent ZStack walker) lands the rotated view's
    // origin where Figma intended.
    const child = rect({
      guid: { sessionID: 1, localID: 2 },
      size: { x: 50, y: 20 },
      fillPaints: [solidPaint({ r: 1, g: 0, b: 0, a: 1 })],
      transform: {
        // 30 degrees CW: cos≈0.866, sin≈0.5
        m00: 0.866, m01: -0.5, m02: 30,
        m10: 0.5, m11: 0.866, m12: 20,
      },
    });
    const node = frame({
      size: { x: 200, y: 200 },
      children: [child],
    });
    const src = serialize(emitNode(node));
    expect(src).toContain(".rotationEffect(.degrees(30), anchor: .topLeading)");
    // Rotation is applied first, then the parent ZStack's
    // placement offset lands the rotated view at (m02, m12).
    expect(src.indexOf(".rotationEffect")).toBeLessThan(src.indexOf(".offset(x: 30, y: 20)"));
  });
});
