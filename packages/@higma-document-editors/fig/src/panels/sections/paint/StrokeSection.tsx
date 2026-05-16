/**
 * @file Stroke property section adapter
 *
 * Converts FigPaint strokes plus stroke-weight/align/cap/join/dash into the
 * kernel stroke view model.
 */

import { useCallback } from "react";
import type { FigDesignNode } from "@higma-document-models/fig/domain";
import type { FigPackageImage } from "@higma-figma-containers/package";
import type { FigStrokeAlign, FigStrokeCap, FigStrokeJoin } from "@higma-document-models/fig/types";
import {
  StrokeSectionView,
  type StrokeAlignId,
  type StrokeCapId,
  type StrokeJoinId,
} from "@higma-editor-kernel/ui/property-sections";
import type { FigEditorAction } from "../../../context/fig-editor/types";
import { createPropertyTargetUpdateAction, type PropertyMutationTarget } from "../../properties/property-mutation-target";
import { usePaintEditor } from "./usePaintEditor";
import { applyAppearanceOperation, AppearanceOp } from "./appearance-domain";
import { figPaintToView } from "./paint-view-adapter";

type StrokeSectionProps = {
  readonly node: FigDesignNode;
  readonly target: PropertyMutationTarget;
  readonly images: ReadonlyMap<string, FigPackageImage>;
  readonly dispatch: (action: FigEditorAction) => void;
};

const STROKE_ALIGN_FALLBACK: StrokeAlignId = "CENTER";
const STROKE_CAP_FALLBACK: StrokeCapId = "NONE";
const STROKE_JOIN_FALLBACK: StrokeJoinId = "MITER";

/** Panel section for editing stroke properties of a Figma node. */
export function StrokeSection({ node, target, images, dispatch }: StrokeSectionProps) {
  const strokeWeight = typeof node.strokeWeight === "number" ? node.strokeWeight : 0;
  const editor = usePaintEditor({ node, target, images, dispatch, kind: "stroke" });

  const updateStrokeWeight = useCallback(
    (weight: number) => {
      dispatch(createPropertyTargetUpdateAction({
        target,
        updater: (n) => applyAppearanceOperation(n, AppearanceOp.strokeWeight(weight)),
      }));
    },
    [dispatch, target],
  );

  const updateStrokeAlign = useCallback(
    (strokeAlign: FigStrokeAlign) => {
      dispatch(createPropertyTargetUpdateAction({
        target,
        updater: (n) => applyAppearanceOperation(n, AppearanceOp.strokeAlign(strokeAlign)),
      }));
    },
    [dispatch, target],
  );

  const updateStrokeCap = useCallback(
    (strokeCap: FigStrokeCap) => {
      dispatch(createPropertyTargetUpdateAction({
        target,
        updater: (n) => applyAppearanceOperation(n, AppearanceOp.strokeCap(strokeCap)),
      }));
    },
    [dispatch, target],
  );

  const updateStrokeJoin = useCallback(
    (strokeJoin: FigStrokeJoin) => {
      dispatch(createPropertyTargetUpdateAction({
        target,
        updater: (n) => applyAppearanceOperation(n, AppearanceOp.strokeJoin(strokeJoin)),
      }));
    },
    [dispatch, target],
  );

  const updateStrokeDashes = useCallback(
    (dashes: readonly number[]) => {
      dispatch(createPropertyTargetUpdateAction({
        target,
        updater: (n) => applyAppearanceOperation(n, AppearanceOp.strokeDashes(
          dashes.length > 0 ? dashes : undefined,
        )),
      }));
    },
    [dispatch, target],
  );

  return (
    <StrokeSectionView
      strokes={node.strokes.map(figPaintToView)}
      strokeWeight={strokeWeight}
      align={(node.strokeAlign as StrokeAlignId | undefined) ?? STROKE_ALIGN_FALLBACK}
      cap={(node.strokeCap as StrokeCapId | undefined) ?? STROKE_CAP_FALLBACK}
      join={(node.strokeJoin as StrokeJoinId | undefined) ?? STROKE_JOIN_FALLBACK}
      dashes={node.strokeDashes ?? []}
      imageOptions={editor.imageOptions}
      fileInputRef={editor.fileInputRef}
      onImageFileChange={editor.handleImageFileChange}
      onStrokeWeightChange={updateStrokeWeight}
      onAlignChange={(value) => updateStrokeAlign(value as FigStrokeAlign)}
      onCapChange={(value) => updateStrokeCap(value as FigStrokeCap)}
      onJoinChange={(value) => updateStrokeJoin(value as FigStrokeJoin)}
      onDashesChange={updateStrokeDashes}
      onAddPaint={editor.addPaint}
      handlers={editor.handlers}
    />
  );
}
