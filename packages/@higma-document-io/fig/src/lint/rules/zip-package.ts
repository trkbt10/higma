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

import { isPng } from "@higma-codecs/png";
import { FIG_THUMBNAIL_ZIP_ENTRY } from "@higma-figma-containers/package";
import type { LintRule } from "../types";

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

  const thumb = ctx.zipEntries.get(FIG_THUMBNAIL_ZIP_ENTRY);
  if (!thumb) {
    emit({
      ruleId: "fig.zip.thumbnail",
      severity: "error",
      path: `zip/${FIG_THUMBNAIL_ZIP_ENTRY}`,
      message: `Required entry ${FIG_THUMBNAIL_ZIP_ENTRY} is missing from the ZIP — Figma will refuse the import`,
      remediation: "Rebuild with exportFig(doc); it always emits a placeholder thumbnail",
    });
    return;
  }
  if (!isPng(thumb)) {
    emit({
      ruleId: "fig.zip.thumbnail",
      severity: "error",
      path: `zip/${FIG_THUMBNAIL_ZIP_ENTRY}`,
      message: `${FIG_THUMBNAIL_ZIP_ENTRY} does not start with the PNG magic — file is corrupted`,
      remediation: "Rewrite thumbnail.png with a valid PNG (`exportFig` writes a 1x1 placeholder)",
    });
  }
};
