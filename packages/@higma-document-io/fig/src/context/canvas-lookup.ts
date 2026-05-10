/**
 * @file Canonical canvas-lookup helpers shared by every `.fig` consumer.
 *
 * These two helpers were copy-pasted across `@higma-tools/fig-to-web/
 * fig-source/load`, `@higma-tools/fig-to-swiftui/fig-source/load`,
 * and `@higma-tools/fig-to-godot/fig-source/load` — the same recursive
 * walk over `tree.roots`, the same DOCUMENT / CANVAS / `internalOnly`
 * filtering, three identical implementations.
 *
 * Lifting them here:
 *
 *   - keeps the scope `@higma-tools` boundary rule happy (sibling
 *     `@higma-tools/*` packages cannot depend on each other), and
 *   - puts the helpers next to the `FigSymbolContext` they operate on,
 *     so a future change to the context shape only has to touch one
 *     place to keep the lookup helpers correct.
 *
 * `loadFigSource` is intentionally **not** added — it would just be an
 * alias for `createFigSymbolContext`. Converters call
 * `createFigSymbolContext` directly; the alias added nothing structural
 * beyond a friendlier name from a tools-side reading order, and the
 * boundary rule made the alias impossible to host in `@higma-tools/`.
 */
import type { FigNode } from "@higma-document-models/fig/types";
import { getNodeType, safeChildren } from "@higma-document-models/fig/domain";
import type { FigSymbolContext } from "./symbol-context";

/** Locate the user-visible CANVAS with the given name (typically "Design"). */
export function findCanvas(source: FigSymbolContext, canvasName: string): FigNode | undefined {
  for (const root of source.tree.roots) {
    if (getNodeType(root) !== "DOCUMENT") {
      continue;
    }
    for (const canvas of safeChildren(root)) {
      if (canvas.name === canvasName && canvas.internalOnly !== true) {
        return canvas;
      }
    }
  }
  return undefined;
}

/** Locate the (single) Internal-Only Canvas — Figma's holder for shared style proxies. */
export function findInternalCanvas(source: FigSymbolContext): FigNode | undefined {
  for (const root of source.tree.roots) {
    if (getNodeType(root) !== "DOCUMENT") {
      continue;
    }
    for (const canvas of safeChildren(root)) {
      if (canvas.internalOnly === true) {
        return canvas;
      }
    }
  }
  return undefined;
}
