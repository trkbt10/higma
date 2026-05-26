/** @file WebGL render paint cache tests. */

import type { ResolvedFillDef } from "../../scene-graph";
import { createWebGLRenderPaintCache } from "./render-paint-cache";

describe("createWebGLRenderPaintCache", () => {
  it("caches parsed hex colors by source string", () => {
    const cache = createWebGLRenderPaintCache();
    const first = cache.colorForHex("#33669980");
    const second = cache.colorForHex("#33669980");

    expect(second).toBe(first);
    expect(first).toEqual({
      r: 0x33 / 255,
      g: 0x66 / 255,
      b: 0x99 / 255,
      a: 0x80 / 255,
    });
  });

  it("rejects non-hex color strings instead of guessing a CSS color", () => {
    const cache = createWebGLRenderPaintCache();

    expect(() => cache.colorForHex("blue")).toThrow("requires #RRGGBB or #RRGGBBAA color");
  });

  it("caches parsed stroke dash patterns by source string", () => {
    const cache = createWebGLRenderPaintCache();
    const first = cache.strokeDashPattern("10 5,2");
    const second = cache.strokeDashPattern("10 5,2");

    expect(second).toBe(first);
    expect(first).toEqual([10, 5, 2]);
  });

  it("rejects invalid stroke dash patterns instead of dropping invalid pieces", () => {
    const cache = createWebGLRenderPaintCache();

    expect(() => cache.strokeDashPattern("10 none")).toThrow("invalid stroke dash component");
  });

  it("caches gradient fills by resolved RenderTree fill def object", () => {
    const cache = createWebGLRenderPaintCache();
    const linearDef: ResolvedFillDef = {
      type: "linear-gradient",
      id: "linear-a",
      x1: "0%",
      y1: "50%",
      x2: "100%",
      y2: "50%",
      stops: [
        { offset: "0%", stopColor: "#000000", stopOpacity: 1 },
        { offset: "100%", stopColor: "#ffffff", stopOpacity: 0.5 },
      ],
    };
    const first = cache.fillForResolvedGradientDef(linearDef);
    const second = cache.fillForResolvedGradientDef(linearDef);

    expect(second).toBe(first);
    expect(first).toEqual({
      type: "linear-gradient",
      start: { x: 0, y: 0.5 },
      end: { x: 1, y: 0.5 },
      stops: [
        { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
        { position: 1, color: { r: 1, g: 1, b: 1, a: 0.5 } },
      ],
      opacity: 1,
    });
  });

  it("rejects invalid gradient coordinates instead of substituting renderer defaults", () => {
    const cache = createWebGLRenderPaintCache();
    const linearDef: ResolvedFillDef = {
      type: "linear-gradient",
      id: "linear-b",
      x1: "left",
      y1: "50%",
      x2: "100%",
      y2: "50%",
      stops: [{ offset: "0%", stopColor: "#000000", stopOpacity: 1 }],
    };

    expect(() => cache.fillForResolvedGradientDef(linearDef)).toThrow("invalid linear-gradient x1 coordinate");
  });

  it("resolves path fillOverride solid paint through the same hex color cache", () => {
    const cache = createWebGLRenderPaintCache();
    const fills = cache.fillsForResolvedFillOverride({
      attrs: { fill: "#336699", fillOpacity: 0.4 },
    }, []);

    expect(fills).toEqual([{
      type: "solid",
      color: { r: 0x33 / 255, g: 0x66 / 255, b: 0x99 / 255, a: 1 },
      opacity: 0.4,
    }]);
  });

  it("preserves path fillOverride blend mode on resolved paint data", () => {
    const cache = createWebGLRenderPaintCache();
    const fills = cache.fillsForResolvedFillOverride({
      attrs: { fill: "#336699" },
      blendMode: "overlay",
    }, []);

    expect(fills).toEqual([{
      type: "solid",
      color: { r: 0x33 / 255, g: 0x66 / 255, b: 0x99 / 255, a: 1 },
      opacity: 1,
      blendMode: "overlay",
    }]);
  });

  it("keeps path fillOverride fill=none as an empty paint list", () => {
    const cache = createWebGLRenderPaintCache();

    expect(cache.fillsForResolvedFillOverride({ attrs: { fill: "none" } }, [])).toEqual([]);
  });

  it("rejects unsupported path fillOverride references without substituting a paint", () => {
    const cache = createWebGLRenderPaintCache();

    expect(() => cache.fillsForResolvedFillOverride({
      attrs: { fill: "url(#paint-unsupported)" },
    }, [])).toThrow("cannot resolve path fillOverride url(#paint-unsupported)");
  });
});
