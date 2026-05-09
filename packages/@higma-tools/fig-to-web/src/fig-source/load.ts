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

/**
 * Re-export of the IO context type under the legacy `FigSource` name.
 *
 * The shape (loaded / tree / nodesByGuid / symbolMap / styleRegistry /
 * blobs / images / metadata) is identical — there is one SoT for "what a
 * loaded .fig file plus its derived maps looks like" and it lives in
 * `@higma-document-io/fig/context`.
 */
export type FigSource = FigSymbolContext;

/** Read the bytes of a fig file and assemble its raw tree view. */
export async function loadFigSource(buffer: Uint8Array): Promise<FigSource> {
  return createFigSymbolContext(buffer);
}

/** Locate the user-visible CANVAS with the given name (typically "Design"). */
export function findCanvas(source: FigSource, canvasName: string): FigNode | undefined {
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
export function findInternalCanvas(source: FigSource): FigNode | undefined {
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
