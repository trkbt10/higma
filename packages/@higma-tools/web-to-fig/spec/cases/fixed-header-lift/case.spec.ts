/**
 * @file Case `fixed-header-lift` — a `position: fixed` subtree leaves
 * the static tree and lands in `viewportLayer` with `sizing: absolute`
 * and viewport-anchored coordinates.
 */
import { normalizeViewport } from "../../../src/normalize";
import { staticFontResolver } from "../../test-font-resolver";
import { fixedHeaderViewport, HEADER_HEIGHT, VIEWPORT_WIDTH } from "./fixture";

describe("case fixed-header-lift", () => {
  const ir = normalizeViewport(fixedHeaderViewport(), { fontResolver: staticFontResolver() });

  it("removes the fixed subtree from the static `main` frame", () => {
    if (ir.root.kind !== "frame") {
      throw new Error("expected frame root");
    }
    const main = ir.root.children[0]!;
    if (main.kind !== "frame") {
      throw new Error("expected main frame");
    }
    // Only the paragraph child remains in flow; the header was lifted.
    expect(main.children).toHaveLength(1);
    expect(main.children[0]!.kind).toBe("text");
  });

  it("lands the header in `viewportLayer` exactly once", () => {
    expect(ir.viewportLayer).toHaveLength(1);
  });

  it("the lifted header sits at the viewport origin with absolute sizing", () => {
    const header = ir.viewportLayer[0]!;
    expect(header.box).toEqual({ x: 0, y: 0, width: VIEWPORT_WIDTH, height: HEADER_HEIGHT });
    expect(header.sizing.mode).toBe("absolute");
  });
});
