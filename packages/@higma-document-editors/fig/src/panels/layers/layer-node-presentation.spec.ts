/** @file Layer node presentation rule tests. */

import { resolveLayerNodePresentation } from "./layer-node-presentation";

describe("resolveLayerNodePresentation", () => {
  it("tints FRAME and SYMBOL icons but does not stamp a redundant text badge", () => {
    // The leading icon shape (FrameIcon vs RectIcon) plus the tint
    // already encodes the type for plain FRAME / SYMBOL / INSTANCE
    // rows. A text badge here would steal the row's name strip and
    // force "App Ic..." truncation, while reading as a redundant
    // banded annotation across same-type runs. Badges are reserved
    // for the cases the icon alone can't communicate ("Set",
    // "Inherited") — see module docblock.
    //
    // The on-disk SYMBOL type encodes the Figma UI concept
    // "Component"; SYMBOL keeps the INSTANCE_COLOR icon tint to
    // match Figma's purple Component palette. See
    // `docs/refactor/component-type-cleanup.md`.
    expect(resolveLayerNodePresentation("FRAME", false)).toEqual({
      iconColor: "#248EFF",
      badge: undefined,
    });
    expect(resolveLayerNodePresentation("SYMBOL", false)).toEqual({
      iconColor: "#9747FF",
      badge: undefined,
    });
    expect(resolveLayerNodePresentation("INSTANCE", false)).toEqual({
      iconColor: "#9747FF",
      badge: undefined,
    });
  });

  it("decorates a Variant-Set FRAME with a Set badge when caller provides the kind", () => {
    // Variant-Set lives on a FRAME disk type — the icon is the same
    // Frame icon as a plain FRAME. The text badge is the only way to
    // communicate the variant-set distinction.
    expect(resolveLayerNodePresentation("FRAME", false, "variant-set")).toEqual({
      iconColor: "#9747FF",
      badge: { label: "Set", color: "#9747FF" },
    });
  });

  it("marks all rows inside an instance as inherited", () => {
    // Children of an INSTANCE inherit from the master SYMBOL.
    // Without the "Inherited" badge a row is indistinguishable from
    // a freely-edited node, so the badge is rendered here.
    expect(resolveLayerNodePresentation("RECTANGLE", true)).toEqual({
      iconColor: "#9747FF",
      badge: { label: "Inherited", color: "#9747FF" },
    });
  });

  it("keeps primitive rows undecorated outside special contexts", () => {
    expect(resolveLayerNodePresentation("RECTANGLE", false)).toEqual({
      iconColor: undefined,
      badge: undefined,
    });
  });
});
