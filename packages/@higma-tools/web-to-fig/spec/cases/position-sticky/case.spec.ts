/**
 * @file Case `position-sticky` — sticky lifts the same way fixed does.
 */
import { normalizeViewport } from "../../../src/normalize";
import { staticFontResolver } from "../../test-font-resolver";
import { stickyToolbarViewport, TOOLBAR_HEIGHT, VIEWPORT_WIDTH } from "./fixture";

describe("case position-sticky", () => {
  const ir = normalizeViewport(stickyToolbarViewport(), { fontResolver: staticFontResolver() });

  it("removes the sticky element from the static tree", () => {
    if (ir.root.kind !== "frame") {
      throw new Error("");
    }
    const main = ir.root.children[0]!;
    if (main.kind !== "frame") {
      throw new Error("");
    }
    expect(main.children).toHaveLength(1);
    expect(main.children[0]!.kind).toBe("text");
  });

  it("lands the sticky element in viewportLayer", () => {
    expect(ir.viewportLayer).toHaveLength(1);
    expect(ir.viewportLayer[0]!.box).toEqual({ x: 0, y: 0, width: VIEWPORT_WIDTH, height: TOOLBAR_HEIGHT });
    expect(ir.viewportLayer[0]!.sizing.mode).toBe("absolute");
  });
});
