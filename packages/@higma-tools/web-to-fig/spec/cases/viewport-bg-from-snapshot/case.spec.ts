/**
 * @file Case `viewport-bg-from-snapshot` — `snapshot.background` is the
 * authoritative canvas paint colour (walker reads it from
 * `getComputedStyle(document.body).backgroundColor`). The IR's root
 * frame must mirror that value even when no element-level `background-
 * color` survives normalisation onto a child node — otherwise the
 * rendered `.fig` paints the canvas transparent and every fullpage
 * case where the body's background colour didn't make it onto a
 * normalised child diffs against a white canvas.
 *
 * Companion to `html-body-bg-propagation`: that case feeds the colour
 * via a body child's `background-color`; this case feeds it via the
 * snapshot's `background` field. Both must land on the root frame's
 * fill — otherwise the propagation path has two leaks instead of one.
 */
import { normalizeViewport } from "../../../src/normalize";
import { synthViewport } from "../../synth-snapshot";
import { staticFontResolver } from "../../test-font-resolver";
import { asFrame } from "../case-ir-assertions";
import { SNAPSHOT_BG, emptyContentChild } from "./fixture";

describe("case viewport-bg-from-snapshot", () => {
  it("paints the root frame with `snapshot.background` when no child carries the colour", () => {
    const ir = normalizeViewport(
      synthViewport({
        background: SNAPSHOT_BG,
        children: [emptyContentChild()],
      }),
      { fontResolver: staticFontResolver() },
    );
    const root = asFrame(ir.root);
    expect(root.style.fills.length).toBeGreaterThanOrEqual(1);
    const solid = root.style.fills.find((f) => f.kind === "solid");
    if (solid === undefined || solid.kind !== "solid") {
      throw new Error("expected a solid fill on root frame");
    }
    expect(Math.round(solid.color.r * 255)).toBe(238);
    expect(Math.round(solid.color.g * 255)).toBe(238);
    expect(Math.round(solid.color.b * 255)).toBe(238);
    expect(solid.color.a).toBe(1);
  });

  it("echoes `snapshot.background` into `viewport.background` (the multi-fig wrapper colour)", () => {
    const ir = normalizeViewport(
      synthViewport({
        background: SNAPSHOT_BG,
        children: [emptyContentChild()],
      }),
      { fontResolver: staticFontResolver() },
    );
    expect(ir.background).toEqual({
      r: 238 / 255,
      g: 238 / 255,
      b: 238 / 255,
      a: 1,
    });
  });

  it("leaves root fills empty when `snapshot.background` is transparent (no spurious paint)", () => {
    const ir = normalizeViewport(
      synthViewport({
        background: "rgba(0, 0, 0, 0)",
        children: [emptyContentChild()],
      }),
      { fontResolver: staticFontResolver() },
    );
    const root = asFrame(ir.root);
    expect(root.style.fills).toHaveLength(0);
  });
});
