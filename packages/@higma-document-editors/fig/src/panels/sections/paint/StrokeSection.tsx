/**
 * @file Stroke property section
 *
 * Edits stroke paints and weight of a selected node.
 * Supports: stroke color editing, weight, opacity, add/remove strokes.
 */

import { useCallback } from "react";
import type { FigDesignNode } from "@higma-document-models/fig/domain";
import type { FigPackageImage } from "@higma-figma-containers/package";
import type { FigStrokeAlign, FigStrokeCap, FigStrokeJoin } from "@higma-document-models/fig/types";
import type { FigEditorAction } from "../../../context/fig-editor/types";
import { Input } from "@higma-editor-kernel/ui/primitives/Input";
import { Select } from "@higma-editor-kernel/ui/primitives/Select";
import { FieldGroup, FieldRow } from "@higma-editor-kernel/ui/layout";
import type { SelectOption } from "@higma-editor-kernel/ui/types";
import { colorTokens, fontTokens } from "@higma-editor-kernel/ui/design-tokens";
import { AddIcon } from "@higma-editor-kernel/ui/icons";
import { createPropertyTargetUpdateAction, type PropertyMutationTarget } from "../../properties/property-mutation-target";
import { usePaintEditor } from "./usePaintEditor";
import { PaintItemEditor } from "./PaintItemEditor";
import { applyAppearanceOperation, AppearanceOp } from "./appearance-domain";
import { sectionContainerStyle, addButtonStyle, IMAGE_ACCEPT_TYPES } from "./paint-section-styles";

const strokeAlignOptions: readonly SelectOption<FigStrokeAlign>[] = [
  { value: "CENTER", label: "Center" },
  { value: "INSIDE", label: "Inside" },
  { value: "OUTSIDE", label: "Outside" },
];

const strokeCapOptions: readonly SelectOption<FigStrokeCap>[] = [
  { value: "NONE", label: "None" },
  { value: "ROUND", label: "Round" },
  { value: "SQUARE", label: "Square" },
  { value: "LINE_ARROW", label: "Line arrow" },
  { value: "TRIANGLE_ARROW", label: "Triangle arrow" },
];

const strokeJoinOptions: readonly SelectOption<FigStrokeJoin>[] = [
  { value: "MITER", label: "Miter" },
  { value: "BEVEL", label: "Bevel" },
  { value: "ROUND", label: "Round" },
];

type StrokeSectionProps = {
  readonly node: FigDesignNode;
  readonly target: PropertyMutationTarget;
  readonly images: ReadonlyMap<string, FigPackageImage>;
  readonly dispatch: (action: FigEditorAction) => void;
};

/** Panel section for editing stroke properties of a Figma node. */
export function StrokeSection({ node, target, images, dispatch }: StrokeSectionProps) {
  const strokeWeight = typeof node.strokeWeight === "number" ? node.strokeWeight : 0;
  const strokes = node.strokes;
  const alignLabel = node.strokeAlign ?? "";
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
    (value: string) => {
      const dashPattern = value
        .split(/[\s,]+/)
        .filter((part) => part.length > 0)
        .map((part) => Number(part));
      if (dashPattern.some((part) => !Number.isFinite(part) || part < 0)) {
        return;
      }
      dispatch(createPropertyTargetUpdateAction({
        target,
        updater: (n) => applyAppearanceOperation(n, AppearanceOp.strokeDashes(
          dashPattern.length > 0 ? dashPattern : undefined,
        )),
      }));
    },
    [dispatch, target],
  );

  const hasContent = strokes.length > 0 || strokeWeight > 0;

  return (
    <div style={sectionContainerStyle}>
      <input
        ref={editor.fileInputRef}
        type="file"
        accept={IMAGE_ACCEPT_TYPES}
        onChange={editor.handleImageFileChange}
        style={{ display: "none" }}
      />
      {hasContent && (
        <>
          <FieldRow>
            <FieldGroup label="Weight" inline labelWidth={50}>
              <Input
                type="number"
                ariaLabel="Stroke weight"
                value={strokeWeight}
                min={0}
                step={0.5}
                onChange={(v) => updateStrokeWeight(v as number)}
                width={60}
              />
            </FieldGroup>
            {alignLabel && (
              <span style={{ fontSize: fontTokens.size.xs, color: colorTokens.text.tertiary }}>
                {alignLabel}
              </span>
            )}
          </FieldRow>
          <FieldRow>
            <FieldGroup label="Align" inline labelWidth={42}>
              <Select
                value={node.strokeAlign ?? "CENTER"}
                onChange={updateStrokeAlign}
                options={strokeAlignOptions}
                ariaLabel="Stroke align"
              />
            </FieldGroup>
          </FieldRow>
          <FieldRow>
            <FieldGroup label="Cap" inline labelWidth={32}>
              <Select
                value={node.strokeCap ?? "NONE"}
                onChange={updateStrokeCap}
                options={strokeCapOptions}
                ariaLabel="Stroke cap"
              />
            </FieldGroup>
            <FieldGroup label="Join" inline labelWidth={36}>
              <Select
                value={node.strokeJoin ?? "MITER"}
                onChange={updateStrokeJoin}
                options={strokeJoinOptions}
                ariaLabel="Stroke join"
              />
            </FieldGroup>
          </FieldRow>
          <FieldRow>
            <FieldGroup label="Dash" inline labelWidth={38}>
              <Input
                type="text"
                ariaLabel="Stroke dash pattern"
                value={(node.strokeDashes ?? []).join(" ")}
                onChange={(v) => updateStrokeDashes(String(v))}
              />
            </FieldGroup>
          </FieldRow>
        </>
      )}

      {strokes.map((stroke, i) => (
        <PaintItemEditor
          key={i}
          paint={stroke}
          index={i}
          labelPrefix="Stroke"
          imageOptions={editor.imageOptions}
          onUpdatePaint={editor.updatePaint}
          onUpdateType={editor.updateType}
          onUpdateOpacity={editor.updateOpacity}
          onUpdateColor={editor.updateColor}
          onUpdateImageRef={editor.updateImageRef}
          onUpdateImageScaleMode={editor.updateImageScaleMode}
          onUpdateImageScale={editor.updateImageScale}
          onUpdateImageRotation={editor.updateImageRotation}
          onStartImageUpload={editor.startImageUpload}
          onRemove={editor.removePaint}
        />
      ))}

      <button type="button" style={addButtonStyle} onClick={editor.addPaint}>
        <AddIcon size={12} />
        Add stroke
      </button>
    </div>
  );
}
