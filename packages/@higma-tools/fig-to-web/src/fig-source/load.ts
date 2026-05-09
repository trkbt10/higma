/**
 * @file Thin adapter over `@higma-document-io/fig/context`'s
 * `createFigSymbolContext`.
 *
 * `loadFigSource` previously rebuilt the same maps `FigSymbolContext`
 * now exposes (raw nodeMap, style-resolved nodesByGuid, style registry,
 * recursive style-id resolution, per-text-run paint resolution). All of
 * that work is owned by the IO context layer — this file is the
 * fig-to-web-specific entry point and adds:
 *
 *   - `findCanvas(source, name)` — locate a user-visible CANVAS by name.
 *   - `findInternalCanvas(source)` — locate the (single) internal-only
 *     CANVAS that Figma uses to hold shared-style proxies.
 *
 * Why this file still exists: the consuming code uses the name
 * `FigSource` and accesses `.loaded`, `.tree`, `.nodesByGuid`,
 * `.styleRegistry` — the public shape of `FigSymbolContext` already
 * matches that contract, so re-exporting under the original name is
 * mechanical.
 */
import type { FigNode } from "@higma-document-models/fig/types";
import { getNodeType, safeChildren } from "@higma-document-models/fig/domain";
import {
  createFigSymbolContext,
  type FigSymbolContext,
} from "@higma-document-io/fig/context";

// `FigSource` was historically an alias of `FigSymbolContext`; consumers
// must now import `FigSymbolContext` directly from
// `@higma-document-io/fig/context`. This module exposes only the
// fig-to-web-specific helpers below.

/** Read the bytes of a fig file and assemble its raw tree view. */
export async function loadFigSource(buffer: Uint8Array): Promise<FigSymbolContext> {
  return createFigSymbolContext(buffer);
}

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

/** Locate the (single) Internal Only Canvas — Figma's holder for shared style proxies. */
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
