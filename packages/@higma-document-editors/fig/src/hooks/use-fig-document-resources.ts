/**
 * @file React hook that exposes the renderer-facing resource bundle from
 * the active fig document.
 *
 * SoT contract
 * ------------
 * Every React surface that drives a fig renderer (FigEditorCanvas,
 * FigPageRenderer, RendererDebugView, FigInspectorOverlay's preview, the
 * WebGL viewport layer) needs the same four maps:
 *
 *   - `symbolMap`     — INSTANCE / SYMBOL resolution
 *   - `styleRegistry` — per-path / per-text-run shared style resolution
 *   - `blobs`         — geometry blobs (fillGeometry, strokeGeometry, …)
 *   - `images`        — IMAGE paint bytes
 *
 * Before this hook, every consumer destructured the four fields off
 * `document` (or `designDoc`, or `figSurface.document`) inline and forwarded
 * them through props. That produced four parallel memoization boundaries
 * and made it easy for one consumer to forget a field. This hook funnels
 * every consumer through a single accessor whose memoization is keyed on
 * the underlying document so the bundle reference stays stable across
 * renders that don't change the document.
 *
 * Two entry points:
 *
 *   - `useFigDocumentResources()` — pulls the active document out of
 *     `FigEditorContext`. Use this inside the editor tree.
 *   - `figDocumentResourcesOf(document)` — for callers that hold a
 *     `FigDesignDocument` directly (dev-only debug views, tests).
 */

import { useMemo } from "react";
import {
  figDocumentResources,
  type FigDocumentResources,
} from "@higma-document-io/fig/context";
import type { FigDesignDocument } from "@higma-document-models/fig/domain";
import { useFigEditor } from "../context/FigEditorContext";

/**
 * Pull the renderer-facing resource bundle from the active document in
 * `FigEditorContext`.
 *
 * The hook owns memoization: the returned bundle reference only changes
 * when the underlying document changes. Consumers that pass the bundle to
 * `useFigSceneGraph` / `FigPageRenderer` rely on this stability to avoid
 * re-building the scene graph on unrelated re-renders.
 */
export function useFigDocumentResources(): FigDocumentResources {
  const { document } = useFigEditor();
  return useMemo(() => figDocumentResources(document), [document]);
}

/**
 * Stand-alone variant for callers that already hold a `FigDesignDocument`
 * outside `FigEditorProvider` — typically the renderer debug view that
 * loads its own document, or test harnesses.
 *
 * The `document` argument MUST be the same reference between renders for
 * memoization to be useful — this is the same contract `useMemo` enforces
 * for inline-built bundles.
 */
export function useFigDocumentResourcesFor(document: FigDesignDocument): FigDocumentResources {
  return useMemo(() => figDocumentResources(document), [document]);
}
