/** @file Inspector boxes derived from renderer SceneGraph node bounds. */

import type { InspectorBoxInfo } from "@higma-editor-kernel/core/inspector-types";
import type { FigKiwiDocumentIndex } from "@higma-document-models/fig/domain";
import { getNodeType } from "@higma-document-models/fig/domain";
import type { SceneGraphNodeBounds } from "@higma-document-renderers/fig/scene-graph";

export type FigInspectorRenderedBoxesOptions = {
  readonly document: FigKiwiDocumentIndex;
  readonly bounds: readonly SceneGraphNodeBounds[];
  readonly shift?: { readonly x: number; readonly y: number };
};

function renderedBoundsTransform(
  bounds: SceneGraphNodeBounds,
  shift: { readonly x: number; readonly y: number } | undefined,
): InspectorBoxInfo["transform"] {
  const radians = bounds.rotation * (Math.PI / 180);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [
    cos,
    sin,
    -sin,
    cos,
    bounds.x + (shift?.x ?? 0),
    bounds.y + (shift?.y ?? 0),
  ];
}

/** Collect inspector boxes from the same SceneGraph bounds consumed by the editor canvas. */
export function collectFigInspectorBoxesFromRenderedNodeBounds({
  document,
  bounds,
  shift,
}: FigInspectorRenderedBoxesOptions): readonly InspectorBoxInfo[] {
  return bounds.map((item) => {
    const node = document.nodesByGuid.get(item.id);
    if (node === undefined) {
      throw new Error(`FigInspectorOverlay: rendered node ${item.id} is not present in the Kiwi document`);
    }
    return {
      nodeId: item.id,
      nodeType: getNodeType(node),
      nodeName: node.name ?? getNodeType(node),
      transform: renderedBoundsTransform(item, shift),
      width: item.width,
      height: item.height,
    };
  });
}
