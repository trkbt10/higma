/** @file GL state cache tests. */

import { createGLStateCache, type GLStateSink } from "./gl-state-cache";

type RecordedCall =
  | { readonly kind: "enable"; readonly capability: number }
  | { readonly kind: "disable"; readonly capability: number }
  | { readonly kind: "colorMask"; readonly r: boolean; readonly g: boolean; readonly b: boolean; readonly a: boolean }
  | { readonly kind: "stencilMask"; readonly mask: number }
  | { readonly kind: "stencilFunc"; readonly func: number; readonly ref: number; readonly mask: number }
  | { readonly kind: "stencilOp"; readonly fail: number; readonly zfail: number; readonly zpass: number }
  | { readonly kind: "stencilOpSeparate"; readonly face: number; readonly fail: number; readonly zfail: number; readonly zpass: number }
  | { readonly kind: "clearStencil"; readonly value: number }
  | { readonly kind: "clear"; readonly mask: number }
  | { readonly kind: "isEnabled"; readonly capability: number };

function makeFakeGL(): { readonly gl: GLStateSink; readonly calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const gl: GLStateSink = {
    STENCIL_TEST: 2960,
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
    enable: (capability: number) => { calls.push({ kind: "enable", capability }); },
    disable: (capability: number) => { calls.push({ kind: "disable", capability }); },
    isEnabled: (capability: number) => {
      calls.push({ kind: "isEnabled", capability });
      return false;
    },
    colorMask: (r: boolean, g: boolean, b: boolean, a: boolean) => { calls.push({ kind: "colorMask", r, g, b, a }); },
    stencilMask: (mask: number) => { calls.push({ kind: "stencilMask", mask }); },
    stencilFunc: (func: number, ref: number, mask: number) => { calls.push({ kind: "stencilFunc", func, ref, mask }); },
    stencilOp: (fail: number, zfail: number, zpass: number) => { calls.push({ kind: "stencilOp", fail, zfail, zpass }); },
    stencilOpSeparate: (face: number, fail: number, zfail: number, zpass: number) => { calls.push({ kind: "stencilOpSeparate", face, fail, zfail, zpass }); },
    clearStencil: (value: number) => { calls.push({ kind: "clearStencil", value }); },
    clear: (mask: number) => { calls.push({ kind: "clear", mask }); },
  };
  return { gl, calls };
}

describe("createGLStateCache", () => {
  it("skips a `gl.stencilOp` write when the requested tuple already matches the WebGL default", () => {
    const { gl, calls } = makeFakeGL();
    const cache = createGLStateCache(gl);
    cache.setStencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    expect(calls.filter((c) => c.kind === "stencilOp")).toHaveLength(0);
  });

  it("writes once, then short-circuits identical re-writes", () => {
    const { gl, calls } = makeFakeGL();
    const cache = createGLStateCache(gl);
    cache.setStencilFunc(gl.EQUAL, 0x80, 0x80);
    cache.setStencilFunc(gl.EQUAL, 0x80, 0x80);
    cache.setStencilFunc(gl.EQUAL, 0x80, 0x80);
    expect(calls.filter((c) => c.kind === "stencilFunc")).toHaveLength(1);
  });

  it("re-writes when any tuple element changes", () => {
    const { gl, calls } = makeFakeGL();
    const cache = createGLStateCache(gl);
    cache.setStencilFunc(gl.EQUAL, 0x80, 0x80);
    cache.setStencilFunc(gl.EQUAL, 0x80, 0xff);
    expect(calls.filter((c) => c.kind === "stencilFunc")).toHaveLength(2);
  });

  it("tracks enable / disable separately per capability", () => {
    const { gl, calls } = makeFakeGL();
    const cache = createGLStateCache(gl);
    cache.setEnabled(gl.STENCIL_TEST, true);
    cache.setEnabled(gl.STENCIL_TEST, true); // skip
    cache.setEnabled(gl.BLEND, false);       // skip — BLEND defaults to false
    cache.setEnabled(gl.STENCIL_TEST, false);
    expect(calls.filter((c) => c.kind === "enable")).toHaveLength(1);
    expect(calls.filter((c) => c.kind === "disable")).toHaveLength(1);
  });

  it("answers `isStencilTestEnabled` from cache without a `gl.isEnabled` round-trip after a known write", () => {
    const { gl, calls } = makeFakeGL();
    const cache = createGLStateCache(gl);
    cache.setEnabled(gl.STENCIL_TEST, true);
    expect(cache.isStencilTestEnabled()).toBe(true);
    expect(cache.isStencilTestEnabled()).toBe(true);
    expect(calls.filter((c) => c.kind === "isEnabled")).toHaveLength(0);
  });

  it("invalidate() drops cached state so the next setter re-writes even when the value is unchanged", () => {
    const { gl, calls } = makeFakeGL();
    const cache = createGLStateCache(gl);
    cache.setStencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
    calls.length = 0;

    cache.invalidate();
    cache.setStencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
    expect(calls.filter((c) => c.kind === "stencilOp")).toHaveLength(1);

    // Cache repopulated — second identical set short-circuits again.
    cache.setStencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
    expect(calls.filter((c) => c.kind === "stencilOp")).toHaveLength(1);
  });

  it("clearStencilBuffer skips the `clearStencil` value when unchanged but always issues `gl.clear`", () => {
    const { gl, calls } = makeFakeGL();
    const cache = createGLStateCache(gl);
    cache.clearStencilBuffer(0); // default is 0, so no clearStencil
    cache.clearStencilBuffer(0);
    expect(calls.filter((c) => c.kind === "clearStencil")).toHaveLength(0);
    expect(calls.filter((c) => c.kind === "clear")).toHaveLength(2);

    cache.clearStencilBuffer(1);
    expect(calls.filter((c) => c.kind === "clearStencil")).toHaveLength(1);
    expect(calls.filter((c) => c.kind === "clear")).toHaveLength(3);
  });
});
