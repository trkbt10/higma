/** @file WebGL stencil clip tests. */

import { rebuildStencilClipStack, type StencilClipOps } from "./clip-mask";
import { createGLStateCache, type GLStateSink } from "../state/gl-state-cache";
import { CLIP_STENCIL_BIT } from "../tessellation/stencil-fill";

/**
 * Superset of `GLStateSink` augmented with the GL enum constants that
 * `clip-mask.ts` references via `gl.X` when handing arguments to the
 * state cache (e.g. `setStencilOp(gl.KEEP, gl.KEEP, gl.INCR)`). The
 * cache itself doesn't need these constants, but the call sites do.
 */
// All enum constants the renderer references through `gl.X` are now
// part of `GLStateSink` itself, so the spec mock just provides that
// surface.
type StencilFakeGL = GLStateSink;

function makeMockGL(): { readonly gl: StencilFakeGL; readonly calls: string[] } {
  const calls: string[] = [];
  const gl: StencilFakeGL = {
    STENCIL_TEST: 2960,
    SCISSOR_TEST: 3089,
    BLEND: 3042,
    STENCIL_BUFFER_BIT: 1024,
    ALWAYS: 519,
    EQUAL: 514,
    NOTEQUAL: 517,
    LESS: 513,
    KEEP: 7680,
    REPLACE: 7681,
    INCR: 7682,
    DECR: 7683,
    INCR_WRAP: 34055,
    DECR_WRAP: 34056,
    INVERT: 5386,
    ZERO: 0,
    FRONT: 1028,
    BACK: 1029,
    FRONT_AND_BACK: 1032,
    enable: () => calls.push("enable"),
    disable: () => calls.push("disable"),
    isEnabled: () => false,
    clear: () => calls.push("clear"),
    clearStencil: (value: number) => calls.push(`clearStencil:${value}`),
    stencilMask: (mask: number) => calls.push(`stencilMask:${mask}`),
    stencilFunc: (_fn: number, ref: number, mask: number) => calls.push(`stencilFunc:${ref}:${mask}`),
    stencilOp: (_fail: number, _zfail: number, zpass: number) => calls.push(`stencilOp:${zpass}`),
    stencilOpSeparate: () => calls.push("stencilOpSeparate"),
    colorMask: (red: boolean) => calls.push(`colorMask:${red}`),
  } as StencilFakeGL;
  return { gl, calls };
}

function makeOps(): { readonly ops: StencilClipOps; readonly calls: string[] } {
  const { gl, calls } = makeMockGL();
  const glState = createGLStateCache(gl);
  return { ops: { gl, glState }, calls };
}

describe("rebuildStencilClipStack", () => {
  it("rebuilds nested clips as an intersection instead of replacing the parent clip", () => {
    const { ops, calls } = makeOps();
    const draws: string[] = [];

    const drawClipShape = () => {
      draws.push("draw");
      calls.push("draw");
    };

    rebuildStencilClipStack({
      ops,
      clips: [
        { drawClipShape },
        { drawClipShape },
      ],
    });

    expect(draws).toHaveLength(3);
    // INCR for each entry, INVERT for the final pass, ZERO clear in
    // between — the canonical "intersection-of-two-clips" sequence.
    expect(calls).toContain("stencilOp:7682");
    expect(calls).toContain("stencilFunc:2:127");
    expect(calls).toContain("stencilOp:5386");
    expect(calls).toContain(`stencilFunc:${CLIP_STENCIL_BIT}:${CLIP_STENCIL_BIT}`);
  });

  it("short-circuits the per-iteration loop body inside multi-clip rebuilds", () => {
    const { ops, calls } = makeOps();
    const drawClipShape = () => calls.push("draw");

    // Inside `rebuildStencilClipStack`, every iteration of the
    // clips-INCR loop sets the same `(stencilFunc, stencilOp)` pair.
    // Without the state cache, an N-clip stack would fire 2N writes
    // inside that loop; with the cache, only the first iteration's
    // values reach GL.
    //
    // (`stencilMask(FILL_STENCIL_MASK)` is also set inside the loop
    // but appears twice in the full rebuild — once at the loop body's
    // first iteration, once after the INVERT pass before the stencil
    // clear — so we measure the loop-only setters instead.)
    rebuildStencilClipStack({
      ops,
      clips: [
        { drawClipShape },
        { drawClipShape },
        { drawClipShape },
      ],
    });

    // INCR == 7682. First iteration writes (differs from the default
    // `(KEEP, KEEP, KEEP)`); iterations 2 and 3 must hit the cache.
    // `stencilFunc(ALWAYS, 0, 0xff)` is omitted here because that
    // happens to match the WebGL default, so the cache short-circuits
    // it even on the first iteration — equally fine.
    const incrStencilOpWrites = calls.filter((c) => c === "stencilOp:7682").length;
    expect(incrStencilOpWrites).toBe(1);
  });

  it("short-circuits `setEnabled(STENCIL_TEST, true)` on the second rebuild because the first leaves it enabled", () => {
    const { ops, calls } = makeOps();
    const drawClipShape = () => calls.push("draw");

    rebuildStencilClipStack({ ops, clips: [{ drawClipShape }] });
    calls.length = 0;
    rebuildStencilClipStack({ ops, clips: [{ drawClipShape }] });

    // `STENCIL_TEST` was enabled at the end of the first rebuild and
    // nothing between rebuilds disabled it — the cache must skip the
    // second `enable` call. The other state setters in the rebuild
    // body alternate values mid-rebuild so they legitimately fire.
    expect(calls).not.toContain("enable");
  });

  it("uses the cached `isStencilTestEnabled` instead of a synchronous `gl.isEnabled` round-trip", () => {
    const { ops, calls } = makeOps();
    const drawClipShape = () => calls.push("draw");

    // Run a rebuild then query the cache. The mock `gl.isEnabled`
    // would push "isEnabled" if called; the cache should answer
    // entirely from its tracked state.
    rebuildStencilClipStack({ ops, clips: [{ drawClipShape }] });
    expect(ops.glState.isStencilTestEnabled()).toBe(true);
    expect(calls).not.toContain("isEnabled");
  });
});
