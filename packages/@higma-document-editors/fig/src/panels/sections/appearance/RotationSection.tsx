/**
 * @file Rotation property section adapter
 *
 * Translates the kernel RotationSectionView's rotation degree, rotate-90 and
 * flip intents into FigDesignNode matrix mutations. Rotation editing reuses
 * `buildRotatedTransform` so the node pivots around its centre; flips are
 * matrix mirrors that preserve the bounding box.
 */

import { useCallback } from "react";
import type { FigDesignNode } from "@higma-document-models/fig/domain";
import { RotationSectionView } from "@higma-editor-kernel/ui";
import type { FigEditorAction } from "../../../context/fig-editor/types";
import { extractRotationDeg, buildRotatedTransform } from "../../../context/fig-editor/rotation";
import { createPropertyPrimaryUpdateAction, type PropertyMutationTarget } from "../../properties/property-mutation-target";
import { flipMatrixHorizontalLocal, flipMatrixVerticalLocal } from "./transform-matrix";

type RotationSectionProps = {
  readonly node: FigDesignNode;
  readonly target: PropertyMutationTarget;
  readonly dispatch: (action: FigEditorAction) => void;
};

/** Rotation degree input + flip/rotate quick actions. */
export function RotationSection({ node, target, dispatch }: RotationSectionProps) {
  const rotation = Math.round(extractRotationDeg(node.transform) * 100) / 100;

  const updateRotation = useCallback(
    (value: number) => {
      dispatch(createPropertyPrimaryUpdateAction({
        target,
        updater: (n) => ({
          ...n,
          transform: buildRotatedTransform({
            currentTransform: n.transform,
            width: n.size.x,
            height: n.size.y,
            newAngleDeg: value,
            origin: n.transformOrigin,
          }),
        }),
      }));
    },
    [dispatch, target],
  );

  const rotate90CW = useCallback(() => {
    dispatch(createPropertyPrimaryUpdateAction({
      target,
      updater: (n) => ({
        ...n,
        transform: buildRotatedTransform({
          currentTransform: n.transform,
          width: n.size.x,
          height: n.size.y,
          newAngleDeg: extractRotationDeg(n.transform) + 90,
          origin: n.transformOrigin,
        }),
      }),
    }));
  }, [dispatch, target]);

  const flipHorizontal = useCallback(() => {
    dispatch(createPropertyPrimaryUpdateAction({
      target,
      updater: (n) => ({ ...n, transform: flipMatrixHorizontalLocal(n.transform, n.size.x) }),
    }));
  }, [dispatch, target]);

  const flipVertical = useCallback(() => {
    dispatch(createPropertyPrimaryUpdateAction({
      target,
      updater: (n) => ({ ...n, transform: flipMatrixVerticalLocal(n.transform, n.size.y) }),
    }));
  }, [dispatch, target]);

  return (
    <RotationSectionView
      rotation={rotation}
      onRotationChange={updateRotation}
      onRotateCW={rotate90CW}
      onFlipHorizontal={flipHorizontal}
      onFlipVertical={flipVertical}
    />
  );
}
