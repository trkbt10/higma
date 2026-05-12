/**
 * @file ZIP-level structural rules.
 *
 * Figma's importer expects every `.fig` to be a ZIP that contains:
 * - `canvas.fig` (the kiwi-encoded document body)
 * - `meta.json`
 * - `thumbnail.png`
 *
 * Loose `canvas.fig` raw files (no ZIP wrapper) round-trip through
 * the project's parser, but Figma will reject them on import. We
 * therefore treat "raw" inputs as a warning, not an error — useful
 * for diagnosing intermediate test fixtures, but never shippable.
 */

import type { LintRule } from "../types";

const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function startsWithPngMagic(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_MAGIC.length) {
    return false;
  }
  for (let i = 0; i < PNG_MAGIC.length; i++) {
    if (bytes[i] !== PNG_MAGIC[i]) {
      return false;
    }
  }
  return true;
}

export const zipPackageRule: LintRule = (ctx, emit) => {
  if (!ctx.isZip) {
    emit({
      ruleId: "fig.zip.header",
      severity: "warning",
      path: "input",
      message: "Input is not a ZIP-wrapped package — Figma cannot import raw canvas.fig",
      remediation: "Build with exportFig(doc) to produce a ZIP-wrapped .fig",
    });
    return;
  }

  if (ctx.canvasData === null) {
    emit({
      ruleId: "fig.zip.canvas-entry",
      severity: "error",
      path: "zip/canvas.fig",
      message: "Required entry canvas.fig is missing from the ZIP",
      remediation: "Re-export from Figma or rebuild via exportFig(doc)",
    });
  }

  if (!ctx.zipEntries.has("meta.json")) {
    emit({
      ruleId: "fig.zip.meta",
      severity: "error",
      path: "zip/meta.json",
      message: "Required entry meta.json is missing from the ZIP",
      remediation: "exportFig(doc) always writes meta.json — regenerate the file",
    });
  }

  const thumb = ctx.zipEntries.get("thumbnail.png");
  if (!thumb) {
    emit({
      ruleId: "fig.zip.thumbnail",
      severity: "error",
      path: "zip/thumbnail.png",
      message: "Required entry thumbnail.png is missing from the ZIP — Figma will refuse the import",
      remediation: "Rebuild with exportFig(doc); it always emits a placeholder thumbnail",
    });
    return;
  }
  if (!startsWithPngMagic(thumb)) {
    emit({
      ruleId: "fig.zip.thumbnail",
      severity: "error",
      path: "zip/thumbnail.png",
      message: "thumbnail.png does not start with the PNG magic — file is corrupted",
      remediation: "Rewrite thumbnail.png with a valid PNG (`exportFig` writes a 1x1 placeholder)",
    });
  }
};
