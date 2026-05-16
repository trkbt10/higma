/**
 * @file Position property section adapter
 *
 * Translates between the kernel PositionSectionView (X/Y) and FigDesignNode's
 * matrix-based transform. Editing X/Y rebuilds the rotation matrix so the
 * node's centre moves while its rotation is preserved.
 */

import { useCallback } from "react";
import type { FigDesignNode } from "@higma-document-models/fig/domain";
import { PositionSectionView, type PositionSectionField } from "@higma-editor-kernel/ui";
import type { FigEditorAction } from "../../../context/fig-editor/types";
import { computePreRotationTopLeft } from "../../../context/fig-editor/rotation";
import { createPropertyPrimaryUpdateAction, type PropertyMutationTarget } from "../../properties/property-mutation-target";
import { rebuildTransformFromTopLeft } from "./transform-matrix";

type PositionSectionProps = {
  readonly node: FigDesignNode;
  readonly target: PropertyMutationTarget;
  readonly dispatch: (action: FigEditorAction) => void;
};

/** Pre-rotation top-left X/Y editor (matches Figma's Position row). */
export function PositionSection({ node, target, dispatch }: PositionSectionProps) {
  const { x: preRotX, y: preRotY } = computePreRotationTopLeft(node.transform, node.size.x, node.size.y);
  const x = Math.round(preRotX * 100) / 100;
  const y = Math.round(preRotY * 100) / 100;

  const updatePosition = useCallback(
    (field: PositionSectionField, value: number) => {
      dispatch(createPropertyPrimaryUpdateAction({
        target,
        updater: (n) => {
          const current = computePreRotationTopLeft(n.transform, n.size.x, n.size.y);
          const next = {
            x: field === "x" ? value : current.x,
            y: field === "y" ? value : current.y,
          };
          return { ...n, transform: rebuildTransformFromTopLeft(n, next) };
        },
      }));
    },
    [dispatch, target],
  );

  return <PositionSectionView x={x} y={y} onChange={updatePosition} />;
}
