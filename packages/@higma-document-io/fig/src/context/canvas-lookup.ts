/**
 * @file Canonical canvas lookup over FigDocumentContext.
 *
 * The indexed Kiwi document owns DOCUMENT / CANVAS / `internalOnly`
 * traversal. Tools consume these lookups directly instead of carrying
 * their own page-discovery functions.
 */
import type { FigKiwiDocumentIndex } from "@higma-document-models/fig/domain";
import type { FigNode } from "@higma-document-models/fig/types";
import { getNodeType } from "@higma-document-models/fig/domain";

/**
 * Locate the user-visible CANVAS with the given name (typically "Design")
 * within the indexed Kiwi document.
 */
export function findCanvas(document: FigKiwiDocumentIndex, canvasName: string): FigNode | undefined {
  for (const root of document.roots) {
    if (getNodeType(root) !== "DOCUMENT") {
      continue;
    }
    for (const canvas of document.childrenOf(root)) {
      if (canvas.name === canvasName && canvas.internalOnly !== true) {
        return canvas;
      }
    }
  }
  return undefined;
}

/** Locate the (single) Internal-Only Canvas — Figma's holder for shared style proxies. */
export function findInternalCanvas(document: FigKiwiDocumentIndex): FigNode | undefined {
  for (const root of document.roots) {
    if (getNodeType(root) !== "DOCUMENT") {
      continue;
    }
    for (const canvas of document.childrenOf(root)) {
      if (canvas.internalOnly === true) {
        return canvas;
      }
    }
  }
  return undefined;
}
