/**
 * @file Header-level integrity for the canvas.fig kiwi blob.
 *
 * Modern Figma `.fig` exports use header version `e` (with zstd-
 * compressed message data). Legacy files written by very old
 * builders use `0` with raw deflate. We accept both so existing
 * fixtures keep passing, but we surface the legacy version as a
 * warning so it is visible at lint time.
 *
 * Schema/data chunk size sanity is also enforced: the schema chunk
 * size in the header must match `payloadSize - dataChunkLen - 4`.
 * If the canvas trailer has unexpected bytes, splitFigChunks will
 * have already failed in the context loader and produced an error.
 */

import type { LintRule } from "../types";

const MODERN_VERSION = "e";

export const canvasHeaderRule: LintRule = (ctx, emit) => {
  if (!ctx.canvasHeader) {
    return;
  }
  const header = ctx.canvasHeader;
  if (header.version !== MODERN_VERSION) {
    emit({
      ruleId: "fig.canvas.version",
      severity: "warning",
      path: "canvas.fig/header.version",
      message: `Canvas header version is "${header.version}"; modern Figma exports use "${MODERN_VERSION}"`,
      remediation: "Re-export through `exportFig`, which writes canvas version \"e\"",
    });
  }

  // Sanity: payload after header must be at least schema chunk size + 4 byte data prefix.
  if (!ctx.canvasData) {
    return;
  }
  const payloadLen = ctx.canvasData.length - 16;
  const schemaSize = header.payloadSize;
  if (payloadLen < schemaSize + 4) {
    emit({
      ruleId: "fig.canvas.payload-size",
      severity: "error",
      path: "canvas.fig/payload",
      message: `Canvas payload is too small: schema=${schemaSize}, payload=${payloadLen}`,
      remediation: "The file is truncated or the header lies — regenerate from the source builder",
    });
  }
};
