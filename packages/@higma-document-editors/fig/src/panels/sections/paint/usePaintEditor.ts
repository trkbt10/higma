/** @file Shared paint editing hook for fill and stroke property sections. */

import { useCallback, useRef, type ChangeEvent, type RefObject } from "react";
import type { FigDesignNode } from "@higma-document-models/fig/domain";
import type { FigPackageImage } from "@higma-figma-containers/package";
import type { FigImageScaleMode, FigPaint } from "@higma-document-models/fig/types";
import type { GradientHandleView, GradientStopView, PaintItemHandlers } from "@higma-editor-kernel/ui/property-sections";
import type { FigEditorAction } from "../../../context/fig-editor/types";
import { createPropertyTargetUpdateAction, type PropertyMutationTarget } from "../../properties/property-mutation-target";
import { createFigImageAsset } from "./image-asset";
import { applyPaintOperation, PaintOp, PaintListOp, type PaintListKind } from "./paint-domain";
import { applyAppearanceOperation, AppearanceOp } from "./appearance-domain";
import {
  addGradientStop,
  removeGradientStop,
  updateGradientHandle,
  updateGradientStop,
} from "./paint-view-adapter";

export type PaintEditorConfig = {
  readonly node: FigDesignNode;
  readonly target: PropertyMutationTarget;
  readonly images: ReadonlyMap<string, FigPackageImage>;
  readonly dispatch: (action: FigEditorAction) => void;
  readonly kind: PaintListKind;
};

export type PaintEditorCallbacks = {
  readonly updatePaint: (index: number, updater: (paint: FigPaint) => FigPaint) => void;
  readonly handlers: PaintItemHandlers;
  readonly handleImageFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly addPaint: () => void;
  readonly uploadTargetRef: RefObject<number | null>;
  readonly fileInputRef: RefObject<HTMLInputElement | null>;
  readonly imageOptions: readonly { readonly value: string; readonly label: string }[];
};

export function usePaintEditor(config: PaintEditorConfig): PaintEditorCallbacks {
  const { target, images, dispatch, kind } = config;
  const uploadTargetRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const appearanceOp = kind === "fill" ? AppearanceOp.fillPaints : AppearanceOp.strokePaints;

  const imageOptions = [
    { value: "", label: "No image" },
    ...[...images.keys()].map((ref) => ({ value: ref, label: ref })),
  ];

  const updatePaint = useCallback(
    (index: number, updater: (paint: FigPaint) => FigPaint) => {
      dispatch(createPropertyTargetUpdateAction({
        target,
        updater: (n) => {
          const paintList = kind === "fill" ? n.fills : n.strokes;
          const paint = paintList[index];
          if (!paint) {
            return n;
          }
          return applyAppearanceOperation(n, appearanceOp(
            PaintListOp.update(index, PaintOp.replace(updater(paint))),
          ));
        },
      }));
    },
    [dispatch, target, kind, appearanceOp],
  );

  const updateColor = useCallback(
    (index: number, hex: string) => {
      updatePaint(index, (paint) => applyPaintOperation(paint, PaintOp.setColor(hex)));
    },
    [updatePaint],
  );

  const updateOpacity = useCallback(
    (index: number, opacity: number) => {
      updatePaint(index, (paint) => applyPaintOperation(paint, PaintOp.setOpacity(opacity)));
    },
    [updatePaint],
  );

  const updateType = useCallback(
    (index: number, type: FigPaint["type"]) => {
      updatePaint(index, (paint) => applyPaintOperation(paint, PaintOp.setType(type, kind)));
    },
    [updatePaint, kind],
  );

  const updateImageRef = useCallback(
    (index: number, imageRef: string) => {
      updatePaint(index, (paint) => applyPaintOperation(paint, PaintOp.setImageRef(imageRef)));
    },
    [updatePaint],
  );

  const updateImageScaleMode = useCallback(
    (index: number, scaleMode: FigImageScaleMode) => {
      updatePaint(index, (paint) => applyPaintOperation(paint, PaintOp.setImageScaleMode(scaleMode)));
    },
    [updatePaint],
  );

  const updateImageScale = useCallback(
    (index: number, scale: number) => {
      updatePaint(index, (paint) => applyPaintOperation(paint, PaintOp.setImageScale(scale)));
    },
    [updatePaint],
  );

  const updateImageRotation = useCallback(
    (index: number, rotationDeg: number) => {
      updatePaint(index, (paint) => applyPaintOperation(paint, PaintOp.setImageRotationDeg(rotationDeg)));
    },
    [updatePaint],
  );

  const startImageUpload = useCallback((index: number) => {
    uploadTargetRef.current = index;
    fileInputRef.current?.click();
  }, []);

  const handleImageFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0];
      const paintIndex = uploadTargetRef.current;
      event.currentTarget.value = "";
      uploadTargetRef.current = null;
      if (!file || paintIndex === null) {
        return;
      }
      void file.arrayBuffer().then((buffer) => {
        const image = createFigImageAsset({
          data: new Uint8Array(buffer),
          mimeType: file.type,
          fileName: file.name,
        });
        dispatch({ type: "ADD_IMAGE_ASSET", image, source: "property-panel" });
        updateImageRef(paintIndex, image.ref);
      });
    },
    [dispatch, updateImageRef],
  );

  const removePaint = useCallback(
    (index: number) => {
      dispatch(createPropertyTargetUpdateAction({
        target,
        updater: (n) => applyAppearanceOperation(n, appearanceOp(PaintListOp.remove(index))),
      }));
    },
    [dispatch, target, appearanceOp],
  );

  const addPaint = useCallback(() => {
    dispatch(createPropertyTargetUpdateAction({
      target,
      updater: (n) => applyAppearanceOperation(n, appearanceOp(PaintListOp.add(kind))),
    }));
  }, [dispatch, target, appearanceOp, kind]);

  const updateGradientStopAt = useCallback(
    (index: number, stopIndex: number, stop: GradientStopView) => {
      updatePaint(index, (paint) => updateGradientStop(paint, stopIndex, stop));
    },
    [updatePaint],
  );

  const addGradientStopAt = useCallback(
    (index: number) => {
      updatePaint(index, addGradientStop);
    },
    [updatePaint],
  );

  const removeGradientStopAt = useCallback(
    (index: number, stopIndex: number) => {
      updatePaint(index, (paint) => removeGradientStop(paint, stopIndex));
    },
    [updatePaint],
  );

  const updateGradientHandleAt = useCallback(
    (index: number, handleIndex: number, handle: GradientHandleView) => {
      updatePaint(index, (paint) => updateGradientHandle(paint, handleIndex, handle));
    },
    [updatePaint],
  );

  const handlers: PaintItemHandlers = {
    onTypeChange: (index, type) => updateType(index, type as FigPaint["type"]),
    onOpacityChange: updateOpacity,
    onColorChange: updateColor,
    onImageRefChange: updateImageRef,
    onImageScaleModeChange: (index, scaleMode) => updateImageScaleMode(index, scaleMode as FigImageScaleMode),
    onImageScaleChange: updateImageScale,
    onImageRotationChange: updateImageRotation,
    onStartImageUpload: startImageUpload,
    onGradientStopChange: updateGradientStopAt,
    onAddGradientStop: addGradientStopAt,
    onRemoveGradientStop: removeGradientStopAt,
    onGradientHandleChange: updateGradientHandleAt,
    onRemove: removePaint,
  };

  return {
    updatePaint,
    handlers,
    handleImageFileChange,
    addPaint,
    uploadTargetRef,
    fileInputRef,
    imageOptions,
  };
}
