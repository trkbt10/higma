/**
 * @file Case `frameset-twin` — verify the normaliser surfaces the
 * frameset-shaped tree assembled from two `<frame>` captures as two
 * absolutely-positioned child FRAMEs whose boxes match the host-page
 * rects.
 *
 * Why an integration spec on top of the unit spec at
 * `src/web-source/frameset.spec.ts`: that file tests the assembler
 * itself; this one proves the assembled tree round-trips through the
 * normaliser without the frameset / frame tags being rewritten,
 * dropped, or absorbed into auto-layout. The Abe-Hiroshi-style
 * legacy site depends on the normaliser leaving the assembled
 * geometry intact.
 */
import { asFrame } from "../case-ir-assertions";
import { normalizeViewport } from "../../../src/normalize";
import { staticFontResolver } from "../../test-font-resolver";
import { LEFT_FRAME_RECT, RIGHT_FRAME_RECT, VIEWPORT, framesetTwin } from "./fixture";

describe("case frameset-twin", () => {
  const ir = normalizeViewport(framesetTwin(), { fontResolver: staticFontResolver() });
  const root = asFrame(ir.root);

  it("preserves the viewport size on the root frame", () => {
    expect(root.box.width).toBe(VIEWPORT.width);
    expect(root.box.height).toBe(VIEWPORT.height);
  });

  it("emits the frameset element as a single child of the synth root", () => {
    expect(root.children.length).toBe(1);
    const frameset = asFrame(root.children[0]!);
    expect(frameset.children.length).toBe(2);
  });

  it("emits two child FRAMEs whose boxes match the captured frame rects", () => {
    const frameset = asFrame(root.children[0]!);
    const left = asFrame(frameset.children[0]!);
    const right = asFrame(frameset.children[1]!);
    expect(left.box.x).toBe(LEFT_FRAME_RECT.x);
    expect(left.box.width).toBe(LEFT_FRAME_RECT.width);
    expect(left.box.height).toBe(LEFT_FRAME_RECT.height);
    expect(right.box.x).toBe(RIGHT_FRAME_RECT.x);
    expect(right.box.width).toBe(RIGHT_FRAME_RECT.width);
    expect(right.box.height).toBe(RIGHT_FRAME_RECT.height);
  });

  it("each frame's inner content lands inside that frame's box", () => {
    // `BoxIR` coordinates are parent-relative (see
    // `BoxIR` in `ir/types.ts`). So a frame at host-x=200 has
    // `box.x = 200` (relative to its parent frameset, which sits at
    // 0,0), but the frame's own children are placed in the frame's
    // local space — their `box.x` is the offset from the *frame's*
    // content box, not from the host viewport. The "is inside"
    // check therefore compares against width/height only.
    const frameset = asFrame(root.children[0]!);
    const left = asFrame(frameset.children[0]!);
    const right = asFrame(frameset.children[1]!);
    function isInside(parentSize: { readonly width: number; readonly height: number }, child: { readonly box: { x: number; y: number; width: number; height: number } }): boolean {
      return child.box.x >= 0
        && child.box.y >= 0
        && child.box.x + child.box.width <= parentSize.width + 0.5
        && child.box.y + child.box.height <= parentSize.height + 0.5;
    }
    for (const c of left.children) {
      expect(isInside(left.box, c), `left descendant out of bounds: ${JSON.stringify(c.box)}`).toBe(true);
    }
    for (const c of right.children) {
      expect(isInside(right.box, c), `right descendant out of bounds: ${JSON.stringify(c.box)}`).toBe(true);
    }
  });
});
