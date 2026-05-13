/**
 * @file Stencil-based clipping and masking for WebGL
 *
 * Uses stencil bit 7 (0x80) for frame clipping.
 * Bits 0-6 (0x7F) are reserved for stencil-based path fill (see stencil-fill.ts).
 *
 * Clip vertex resolution is the caller's responsibility — pan/zoom
 * rerenders push and pop the same clip many times per frame, and only
 * the renderer (with its node-keyed geometry cache) knows how to reuse
 * the tessellation across rebuilds. `StencilClipEntry.drawClipShape`
 * therefore captures the pre-resolved vertices in a closure so this
 * module never re-tessellates on rebuild.
 *
 * State changes go through `GLStateCache` so consecutive rebuilds skip
 * the GL setter when the value is already current — `stencilOp(KEEP,
 * KEEP, KEEP)`, `stencilFunc(EQUAL, CLIP_STENCIL_BIT, CLIP_STENCIL_BIT)`,
 * and the `colorMask(true,...)` reset all repeat unchanged between
 * back-to-back push/pop pairs during scroll.
 */

import type { GLStateCache, GLStateSink } from "../state/gl-state-cache";
import { CLIP_STENCIL_BIT, FILL_STENCIL_MASK } from "../tessellation/stencil-fill";

export type StencilClipEntry = {
  /**
   * Draw the clip shape's tessellated geometry to whatever GL state
   * `rebuildStencilClipStack` has just configured. Implementations
   * should capture pre-resolved vertices in the closure so repeated
   * clip rebuilds do not re-tessellate.
   */
  readonly drawClipShape: () => void;
};

export type StencilClipOps = {
  readonly gl: GLStateSink;
  readonly glState: GLStateCache;
};

function finishStencilClip(ops: StencilClipOps): void {
  ops.glState.setColorMask(true, true, true, true);
  ops.glState.setStencilMask(0xff);

  // Set stencil test to only pass where bit 7 is set
  ops.glState.setStencilFunc(ops.gl.EQUAL, CLIP_STENCIL_BIT, CLIP_STENCIL_BIT);
  ops.glState.setStencilOp(ops.gl.KEEP, ops.gl.KEEP, ops.gl.KEEP);
}

/**
 * Begin a stencil clip region
 *
 * Draws the clip shape into stencil bit 7, then enables stencil testing
 * so only pixels inside the clip shape are rendered.
 */
export function beginStencilClip(
  {
    ops,
    drawClipShape,
  }: {
    ops: StencilClipOps;
    drawClipShape: () => void;
  }
): void {
  const { gl, glState } = ops;
  glState.setEnabled(gl.STENCIL_TEST, true);
  glState.setColorMask(false, false, false, false);

  glState.setStencilMask(CLIP_STENCIL_BIT);
  glState.clearStencilBuffer(0);

  // Draw clip shape into stencil bit 7 — stencilMask already restricted
  // to CLIP_STENCIL_BIT above, so no second redundant set here.
  glState.setStencilFunc(gl.ALWAYS, CLIP_STENCIL_BIT, 0xff);
  glState.setStencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
  drawClipShape();

  finishStencilClip(ops);
}

/** Rebuild the active stencil clip from the full clip stack. */
export function rebuildStencilClipStack({
  ops,
  clips,
}: {
  readonly ops: StencilClipOps;
  readonly clips: readonly StencilClipEntry[];
}): void {
  if (clips.length === 0) {
    endStencilClip(ops);
    return;
  }

  if (clips.length === 1) {
    beginStencilClip({ ops, drawClipShape: clips[0].drawClipShape });
    return;
  }

  const { gl, glState } = ops;
  glState.setEnabled(gl.STENCIL_TEST, true);
  glState.setColorMask(false, false, false, false);
  glState.setStencilMask(0xff);
  glState.clearStencilBuffer(0);

  for (const entry of clips) {
    glState.setStencilMask(FILL_STENCIL_MASK);
    glState.setStencilFunc(gl.ALWAYS, 0, 0xff);
    glState.setStencilOp(gl.KEEP, gl.KEEP, gl.INCR);
    entry.drawClipShape();
  }

  const lastClip = clips[clips.length - 1];
  glState.setStencilMask(CLIP_STENCIL_BIT);
  glState.setStencilFunc(gl.EQUAL, clips.length, FILL_STENCIL_MASK);
  glState.setStencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
  lastClip.drawClipShape();

  glState.setStencilMask(FILL_STENCIL_MASK);
  glState.clearStencilBuffer(0);

  finishStencilClip(ops);
}

/** End a stencil clip region */
export function endStencilClip(ops: StencilClipOps): void {
  ops.glState.setEnabled(ops.gl.STENCIL_TEST, false);
}
