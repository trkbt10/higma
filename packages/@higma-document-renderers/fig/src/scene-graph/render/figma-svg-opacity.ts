/** @file Figma SVG opacity serialization rules. */

const KIWI_TINY_OPACITY_SENTINEL = Math.fround(0.0001);
const FIGMA_SVG_TINY_OPACITY = 0.01;

/**
 * Resolve paint opacity to the value Figma serializes into SVG output.
 *
 * Figma-authored .fig files store the UI's tiny visible opacity sentinel
 * as float32 `0.0001`, while Figma's own SVG exporter writes that sentinel
 * as `0.01` for both paint opacity and gradient stop alpha.
 */
export function resolveFigmaSvgOpacity(opacity: number): number {
  if (opacity === KIWI_TINY_OPACITY_SENTINEL) {
    return FIGMA_SVG_TINY_OPACITY;
  }
  return opacity;
}
