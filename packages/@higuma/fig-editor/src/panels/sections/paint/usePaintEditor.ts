/** @file Shared paint editing hook for fill and stroke property sections. */

import { useCallback, useRef, type ChangeEvent, type RefObject } from "react";
import type { FigDesignNode } from "@higuma/fig/domain";
import type { FigImage } from "@higuma/fig/parser";
import type { FigImageScaleMode, FigPaint } from "@higuma/fig/types";
import type { FigEditorAction } from "../../../context/fig-editor/types";
import { createPropertyTargetUpdateAction, type PropertyMutationTarget } from "../../properties/property-mutation-target";
import { createFigImageAsset } from "./image-asset";
import { applyPaintOperation, PaintOp, PaintListOp, type PaintListKind } from "./paint-domain";
import { applyAppearanceOperation, AppearanceOp } from "./appearance-domain";

export type PaintEditorConfig = {
  readonly node: FigDesignNode;
  readonly target: PropertyMutationTarget;
  readonly images: ReadonlyMap<string, FigImage>;
  readonly dispatch: (action: FigEditorAction) => void;
  readonly kind: PaintListKind;
};

export type PaintEditorCallbacks = {
  readonly updatePaint: (index: number, updater: (paint: FigPaint) => FigPaint) => void;
  readonly updateColor: (index: number, hex: string) => void;
  readonly updateOpacity: (index: number, opacity: number) => void;
  readonly updateType: (index: number, type: FigPaint["type"]) => void;
  readonly updateImageRef: (index: number, imageRef: string) => void;
  readonly updateImageScaleMode: (index: number, scaleMode: FigImageScaleMode) => void;
  readonly updateImageScale: (index: number, scale: number) => void;
  readonly updateImageRotation: (index: number, rotationDeg: number) => void;
  readonly startImageUpload: (index: number) => void;
  readonly handleImageFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly removePaint: (index: number) => void;
  readonly addPaint: () => void;
  readonly uploadTargetRef: RefObject<number | null>;
  readonly fileInputRef: RefObject<HTMLInputElement | null>;
  readonly imageOptions: readonly { readonly value: string; readonly label: string }[];
};

export function usePaintEditor(config: PaintEditorConfig): PaintEditorCallbacks {
  const { node, target, images, dispatch, kind } = config;
  const uploadTargetRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const paints = kind === "fill" ? node.fills : node.strokes;
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

  return {
    updatePaint,
    updateColor,
    updateOpacity,
    updateType,
    updateImageRef,
    updateImageScaleMode,
    updateImageScale,
    updateImageRotation,
    startImageUpload,
    handleImageFileChange,
    removePaint,
    addPaint,
    uploadTargetRef,
    fileInputRef,
    imageOptions,
  };
}
