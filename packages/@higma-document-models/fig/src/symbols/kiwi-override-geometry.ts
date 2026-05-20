/** @file Geometry payload detection for Kiwi symbol overrides. */
import type { FigKiwiSymbolOverride } from "@higma-document-models/fig/types";

/** Return true when a Kiwi override carries authored vector geometry. */
export function kiwiSymbolOverrideCarriesGeometry(entry: FigKiwiSymbolOverride): boolean {
  return (
    (entry.fillGeometry !== undefined && entry.fillGeometry.length > 0) ||
    (entry.strokeGeometry !== undefined && entry.strokeGeometry.length > 0) ||
    (entry.vectorPaths !== undefined && entry.vectorPaths.length > 0)
  );
}
