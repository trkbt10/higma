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
 * List user-visible CANVAS nodes directly owned by the DOCUMENT node.
 */
export function findCanvases(document: FigKiwiDocumentIndex): readonly FigNode[] {
  const canvases: FigNode[] = [];
  for (const root of document.roots) {
    if (getNodeType(root) !== "DOCUMENT") {
      continue;
    }
    for (const canvas of document.childrenOf(root)) {
      if (getNodeType(canvas) === "CANVAS" && canvas.internalOnly !== true && canvas.visible !== false) {
        canvases.push(canvas);
      }
    }
  }
  return canvases;
}

/**
 * Locate the user-visible CANVAS with the given name (typically "Design")
 * within the indexed Kiwi document.
 */
export function findCanvas(document: FigKiwiDocumentIndex, canvasName: string): FigNode | undefined {
  return findCanvases(document).find((canvas) => canvas.name === canvasName);
}

/**
 * Locate a user-visible CANVAS by name or fail at the construction boundary.
 */
export function requireCanvas(document: FigKiwiDocumentIndex, canvasName: string): FigNode {
  const canvas = findCanvas(document, canvasName);
  if (canvas === undefined) {
    throw new Error(`requireCanvas: CANVAS "${canvasName}" does not exist`);
  }
  return canvas;
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

/**
 * Locate the Internal-Only Canvas or fail at the construction boundary.
 */
export function requireInternalCanvas(document: FigKiwiDocumentIndex): FigNode {
  const canvas = findInternalCanvas(document);
  if (canvas === undefined) {
    throw new Error("requireInternalCanvas: internal CANVAS does not exist");
  }
  return canvas;
}
