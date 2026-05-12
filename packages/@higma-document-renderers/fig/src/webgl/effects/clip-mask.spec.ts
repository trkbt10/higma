/** @file WebGL stencil clip tests. */

import { rebuildStencilClipStack } from "./clip-mask";
import { CLIP_STENCIL_BIT } from "../tessellation/stencil-fill";

type MockStencilClipGL = Parameters<typeof rebuildStencilClipStack>[0]["gl"];

function makeMockGL(): { readonly gl: MockStencilClipGL; readonly calls: string[] } {
  const calls: string[] = [];
  const gl: MockStencilClipGL = {
    STENCIL_TEST: 2960,
    STENCIL_BUFFER_BIT: 1024,
    ALWAYS: 519,
    EQUAL: 514,
    KEEP: 7680,
    INVERT: 5386,
    INCR: 7682,
    REPLACE: 7681,
    ZERO: 0,
    enable: () => calls.push("enable"),
    disable: () => calls.push("disable"),
    clear: () => calls.push("clear"),
    clearStencil: (value: number) => calls.push(`clearStencil:${value}`),
    stencilMask: (mask: number) => calls.push(`stencilMask:${mask}`),
    stencilFunc: (_fn: number, ref: number, mask: number) => calls.push(`stencilFunc:${ref}:${mask}`),
    stencilOp: (_fail: number, _zfail: number, zpass: number) => calls.push(`stencilOp:${zpass}`),
    colorMask: (red: boolean) => calls.push(`colorMask:${red}`),
  };
  return { gl, calls };
}

describe("beginStencilClip", () => {
  it("rebuilds nested clips as an intersection instead of replacing the parent clip", () => {
    const { gl, calls } = makeMockGL();
    const draws: string[] = [];

    const drawVertices = () => {
      draws.push("draw");
      calls.push("draw");
    };

    rebuildStencilClipStack({
      gl,
      clips: [
        { clip: { type: "rect", width: 100, height: 80 }, drawVertices },
        { clip: { type: "rect", width: 40, height: 30 }, drawVertices },
      ],
    });

    expect(draws).toHaveLength(3);
    expect(calls.slice(0, 6)).toEqual([
      "enable",
      "colorMask:false",
      "stencilMask:255",
      "clearStencil:0",
      "clear",
      "stencilMask:127",
    ]);
    expect(calls).toContain("stencilOp:7682");
    expect(calls).toContain("stencilFunc:2:127");
    expect(calls).toContain("stencilOp:5386");
    expect(calls).toContain(`stencilFunc:${CLIP_STENCIL_BIT}:${CLIP_STENCIL_BIT}`);
  });
});
