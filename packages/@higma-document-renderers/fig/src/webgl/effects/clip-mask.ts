/**
 * @file Stencil-based clipping and masking for WebGL
 *
 * Uses stencil bit 7 (0x80) for frame clipping.
 * Bits 0-6 (0x7F) are reserved for stencil-based path fill (see stencil-fill.ts).
 */

import type { ClipShape } from "@higma-document-models/fig/scene-graph";
import { generateRectVertices, tessellateContours } from "../tessellation/tessellation";
import { CLIP_STENCIL_BIT, FILL_STENCIL_MASK } from "../tessellation/stencil-fill";

type StencilClipGL = Pick<
  WebGLRenderingContext,
  | "STENCIL_TEST"
  | "STENCIL_BUFFER_BIT"
  | "ALWAYS"
  | "EQUAL"
  | "KEEP"
  | "INVERT"
  | "INCR"
  | "REPLACE"
  | "ZERO"
  | "enable"
  | "disable"
  | "clear"
  | "clearStencil"
  | "stencilMask"
  | "stencilFunc"
  | "stencilOp"
  | "colorMask"
>;

export type StencilClipEntry = {
  readonly clip: ClipShape;
  readonly drawVertices: (vertices: Float32Array) => void;
};

function resolveClipVertices(clip: ClipShape): Float32Array {
  if (clip.type === "rect") {
    return generateRectVertices(clip.width, clip.height, clip.cornerRadius);
  }
  return tessellateContours(clip.contours, 0.25, true);
}

function finishStencilClip(gl: StencilClipGL): void {
  gl.colorMask(true, true, true, true);
  gl.stencilMask(0xff);

  // Set stencil test to only pass where bit 7 is set
  gl.stencilFunc(gl.EQUAL, CLIP_STENCIL_BIT, CLIP_STENCIL_BIT);
  gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
}

/**
 * Begin a stencil clip region
 *
 * Draws the clip shape into stencil bit 7, then enables stencil testing
 * so only pixels inside the clip shape are rendered.
 */
export function beginStencilClip(
  {
    gl,
    clip,
    _positionBuffer,
    drawVertices,
  }: {
    gl: StencilClipGL;
    clip: ClipShape;
    _positionBuffer: unknown;
    drawVertices: (vertices: Float32Array) => void;
  }
): void {
  gl.enable(gl.STENCIL_TEST);
  gl.colorMask(false, false, false, false);

  gl.stencilMask(CLIP_STENCIL_BIT);
  gl.clearStencil(0);
  gl.clear(gl.STENCIL_BUFFER_BIT);

  // Draw clip shape into stencil bit 7
  gl.stencilMask(CLIP_STENCIL_BIT);
  gl.stencilFunc(gl.ALWAYS, CLIP_STENCIL_BIT, 0xff);
  gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
  drawVertices(resolveClipVertices(clip));

  finishStencilClip(gl);
}

/** Rebuild the active stencil clip from the full clip stack. */
export function rebuildStencilClipStack({
  gl,
  clips,
}: {
  readonly gl: StencilClipGL;
  readonly clips: readonly StencilClipEntry[];
}): void {
  if (clips.length === 0) {
    endStencilClip(gl);
    return;
  }

  if (clips.length === 1) {
    const entry = clips[0];
    beginStencilClip({ gl, clip: entry.clip, _positionBuffer: undefined, drawVertices: entry.drawVertices });
    return;
  }

  gl.enable(gl.STENCIL_TEST);
  gl.colorMask(false, false, false, false);
  gl.stencilMask(0xff);
  gl.clearStencil(0);
  gl.clear(gl.STENCIL_BUFFER_BIT);

  for (const entry of clips) {
    gl.stencilMask(FILL_STENCIL_MASK);
    gl.stencilFunc(gl.ALWAYS, 0, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
    entry.drawVertices(resolveClipVertices(entry.clip));
  }

  const lastClip = clips[clips.length - 1];
  gl.stencilMask(CLIP_STENCIL_BIT);
  gl.stencilFunc(gl.EQUAL, clips.length, FILL_STENCIL_MASK);
  gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
  lastClip.drawVertices(resolveClipVertices(lastClip.clip));

  gl.stencilMask(FILL_STENCIL_MASK);
  gl.clearStencil(0);
  gl.clear(gl.STENCIL_BUFFER_BIT);

  finishStencilClip(gl);
}

/**
 * End a stencil clip region
 */
export function endStencilClip(gl: StencilClipGL): void {
  gl.disable(gl.STENCIL_TEST);
}
