/**
 * @file GL state cache — short-circuits redundant `gl.stencilOp`,
 * `gl.stencilFunc`, `gl.stencilMask`, `gl.colorMask`, `gl.enable`,
 * `gl.disable`, `gl.clearStencil` calls.
 *
 * Scrolling a Figma scene rebuilds the stencil clip stack many times
 * per frame (every clipped FRAME push / pop). Each rebuild fires a
 * dozen state-setting calls, most of which set the same value as the
 * previous rebuild's tail (`stencilOp(KEEP,KEEP,KEEP)`,
 * `stencilFunc(EQUAL, CLIP_STENCIL_BIT, CLIP_STENCIL_BIT)`, …). The
 * JS→native crossing for each call is small but non-zero, and the
 * volume scales with scene complexity.
 *
 * This cache mirrors the WebGL state machine: each setter compares the
 * incoming arguments against the last known value and skips the GL
 * call when they match. Initial values track the WebGL 1.0 defaults
 * (per spec). Subsystems that touch state outside the cache (effect
 * rendering uses framebuffer-bound programs and changes blend / stencil
 * state directly) must call `invalidate()` before returning so the
 * cache stops short-circuiting against stale values.
 */

/**
 * State-mutating subset of `WebGLRenderingContext` used by the
 * renderer's stencil pipeline, plus the GL enum constants that
 * callers reference via `gl.X` when assembling stencil sequences.
 * Includes both the methods the cache calls (`enable`, `stencilOp`,
 * …) and the values the renderer passes through it (`ALWAYS`,
 * `INCR`, `INVERT`, `EQUAL`, `REPLACE`, …).
 */
export type GLStateSink = Pick<
  WebGLRenderingContext,
  | "STENCIL_TEST"
  | "BLEND"
  | "FRONT"
  | "BACK"
  | "FRONT_AND_BACK"
  | "ALWAYS"
  | "EQUAL"
  | "NOTEQUAL"
  | "LESS"
  | "KEEP"
  | "REPLACE"
  | "INCR"
  | "DECR"
  | "INCR_WRAP"
  | "DECR_WRAP"
  | "INVERT"
  | "ZERO"
  | "STENCIL_BUFFER_BIT"
  | "enable"
  | "disable"
  | "isEnabled"
  | "colorMask"
  | "stencilMask"
  | "stencilFunc"
  | "stencilOp"
  | "stencilOpSeparate"
  | "clearStencil"
  | "clear"
>;

export type GLStateCache = {
  /** Toggle a GL capability (e.g. `STENCIL_TEST`, `BLEND`). */
  readonly setEnabled: (capability: number, enabled: boolean) => void;
  readonly setColorMask: (r: boolean, g: boolean, b: boolean, a: boolean) => void;
  readonly setStencilMask: (mask: number) => void;
  readonly setStencilFunc: (func: number, ref: number, mask: number) => void;
  readonly setStencilOp: (fail: number, zfail: number, zpass: number) => void;
  readonly setStencilOpSeparate: (face: number, fail: number, zfail: number, zpass: number) => void;
  /**
   * Set the stencil-clear value and clear the stencil buffer in one
   * call. Combines `gl.clearStencil(s)` with `gl.clear(STENCIL_BUFFER_BIT)`
   * so the cache can skip the redundant `clearStencil` write when the
   * value is already current.
   */
  readonly clearStencilBuffer: (value: number) => void;
  /**
   * Return `true` if STENCIL_TEST is currently enabled. Cached, so
   * this avoids the synchronous `gl.isEnabled` round-trip when the
   * cache already knows the answer.
   */
  readonly isStencilTestEnabled: () => boolean;
  /**
   * Drop every cached value. Call after a subsystem (e.g. effect
   * rendering) has mutated GL state outside this cache.
   */
  readonly invalidate: () => void;
};

/**
 * WebGL 1.0 default state per the spec. We seed the cache with these
 * so the first call by the renderer (which typically sets state away
 * from defaults) lands as a "value changed → write" instead of a
 * mistaken cache hit.
 */
function makeDefaults(gl: GLStateSink): {
  enabled: Map<number, boolean>;
  colorMask: readonly [boolean, boolean, boolean, boolean];
  stencilMask: number;
  stencilFunc: readonly [number, number, number];
  stencilOp: readonly [number, number, number];
  clearStencil: number;
} {
  return {
    enabled: new Map<number, boolean>([
      [gl.STENCIL_TEST, false],
      [gl.BLEND, false],
    ]),
    colorMask: [true, true, true, true],
    stencilMask: 0xff,
    stencilFunc: [gl.ALWAYS, 0, 0xff],
    stencilOp: [gl.KEEP, gl.KEEP, gl.KEEP],
    clearStencil: 0,
  };
}

type ColorMaskTuple = readonly [boolean, boolean, boolean, boolean];
type StencilFuncTuple = readonly [number, number, number];
type StencilOpTuple = readonly [number, number, number];

/**
 * Create a GL state cache backed by the given context.
 *
 * Cached values are nullable: `null` means "unknown — next set always
 * writes". Initial values match the WebGL 1.0 defaults so untouched
 * state stays consistent with the GL context; `invalidate()` resets to
 * `null` everywhere so a stale-cache short-circuit can't happen after
 * external code (effect rendering, blend toggling) mutates state.
 */
export function createGLStateCache(gl: GLStateSink): GLStateCache {
  const defaults = makeDefaults(gl);
  const enabledRef = { value: new Map<number, boolean>(defaults.enabled) };
  const colorMaskRef = { value: defaults.colorMask as ColorMaskTuple | null };
  const stencilMaskRef = { value: defaults.stencilMask as number | null };
  const stencilFuncRef = { value: defaults.stencilFunc as StencilFuncTuple | null };
  const stencilOpRef = { value: defaults.stencilOp as StencilOpTuple | null };
  const stencilOpFrontRef = { value: null as StencilOpTuple | null };
  const stencilOpBackRef = { value: null as StencilOpTuple | null };
  const clearStencilRef = { value: defaults.clearStencil as number | null };

  function setEnabledImpl(capability: number, enabled: boolean): void {
    const cached = enabledRef.value.get(capability);
    if (cached === enabled) {
      return;
    }
    if (enabled) {
      gl.enable(capability);
    } else {
      gl.disable(capability);
    }
    enabledRef.value.set(capability, enabled);
  }

  return {
    setEnabled: setEnabledImpl,

    setColorMask(r, g, b, a) {
      const cur = colorMaskRef.value;
      if (cur !== null && cur[0] === r && cur[1] === g && cur[2] === b && cur[3] === a) {
        return;
      }
      gl.colorMask(r, g, b, a);
      colorMaskRef.value = [r, g, b, a];
    },

    setStencilMask(mask) {
      if (stencilMaskRef.value === mask) {
        return;
      }
      gl.stencilMask(mask);
      stencilMaskRef.value = mask;
    },

    setStencilFunc(func, ref, mask) {
      const cur = stencilFuncRef.value;
      if (cur !== null && cur[0] === func && cur[1] === ref && cur[2] === mask) {
        return;
      }
      gl.stencilFunc(func, ref, mask);
      stencilFuncRef.value = [func, ref, mask];
    },

    setStencilOp(fail, zfail, zpass) {
      const cur = stencilOpRef.value;
      if (cur !== null && cur[0] === fail && cur[1] === zfail && cur[2] === zpass) {
        return;
      }
      gl.stencilOp(fail, zfail, zpass);
      const tuple: StencilOpTuple = [fail, zfail, zpass];
      stencilOpRef.value = tuple;
      // `gl.stencilOp` writes both front and back faces, so any
      // previously-cached per-face state matches this unified tuple.
      stencilOpFrontRef.value = tuple;
      stencilOpBackRef.value = tuple;
    },

    setStencilOpSeparate(face, fail, zfail, zpass) {
      const tuple: StencilOpTuple = [fail, zfail, zpass];
      if (face === gl.FRONT_AND_BACK) {
        const cur = stencilOpRef.value;
        if (cur !== null && cur[0] === fail && cur[1] === zfail && cur[2] === zpass) {
          return;
        }
        gl.stencilOpSeparate(face, fail, zfail, zpass);
        stencilOpRef.value = tuple;
        stencilOpFrontRef.value = tuple;
        stencilOpBackRef.value = tuple;
        return;
      }
      if (face === gl.FRONT) {
        const cur = stencilOpFrontRef.value;
        if (cur !== null && cur[0] === fail && cur[1] === zfail && cur[2] === zpass) {
          return;
        }
        gl.stencilOpSeparate(face, fail, zfail, zpass);
        stencilOpFrontRef.value = tuple;
        // Unified `stencilOp` cache is no longer consistent across faces.
        stencilOpRef.value = null;
        return;
      }
      if (face === gl.BACK) {
        const cur = stencilOpBackRef.value;
        if (cur !== null && cur[0] === fail && cur[1] === zfail && cur[2] === zpass) {
          return;
        }
        gl.stencilOpSeparate(face, fail, zfail, zpass);
        stencilOpBackRef.value = tuple;
        stencilOpRef.value = null;
        return;
      }
      // Unknown face enum — pass through without caching, fail safe.
      gl.stencilOpSeparate(face, fail, zfail, zpass);
      stencilOpRef.value = null;
      stencilOpFrontRef.value = null;
      stencilOpBackRef.value = null;
    },

    clearStencilBuffer(value) {
      if (clearStencilRef.value !== value) {
        gl.clearStencil(value);
        clearStencilRef.value = value;
      }
      gl.clear(gl.STENCIL_BUFFER_BIT);
    },

    isStencilTestEnabled() {
      const cached = enabledRef.value.get(gl.STENCIL_TEST);
      if (cached !== undefined) {
        return cached;
      }
      const enabled = gl.isEnabled(gl.STENCIL_TEST);
      enabledRef.value.set(gl.STENCIL_TEST, enabled);
      return enabled;
    },

    invalidate() {
      enabledRef.value = new Map();
      colorMaskRef.value = null;
      stencilMaskRef.value = null;
      stencilFuncRef.value = null;
      stencilOpRef.value = null;
      stencilOpFrontRef.value = null;
      stencilOpBackRef.value = null;
      clearStencilRef.value = null;
    },
  };
}
