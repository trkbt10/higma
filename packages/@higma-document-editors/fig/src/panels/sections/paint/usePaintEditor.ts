/** @file React hook for editing Kiwi paint fields from property sections. */
import { useCallback, useRef, type ChangeEvent, type RefObject } from "react";
import type {
  GradientHandleView,
  GradientStopView,
  ImageScaleModeId,
  PaintItemHandlers,
  PaintTypeId,
} from "@higma-editor-kernel/ui/property-sections";
import { FIG_NODE_MUTATION_SOURCE, useFigEditor } from "../../../context/FigEditorContext";
import { createFigImageAsset } from "./image-asset";
import {
  addGradientStop,
  addPaint,
  paintList,
  removeGradientStop,
  removePaint,
  replacePaint,
  setGradientHandle,
  setGradientStop,
  setImageHashHex,
  setImageRotationDeg,
  setImageScale,
  setImageScaleMode,
  setPaintColor,
  setPaintOpacity,
  setPaintType,
  writePaintList,
  type PaintListKind,
} from "./paint-domain";

export type PaintEditor = {
  readonly handlers: PaintItemHandlers;
  readonly handleImageFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly addPaint: () => void;
  readonly uploadTargetRef: RefObject<number | null>;
  readonly fileInputRef: RefObject<HTMLInputElement | null>;
  readonly imageOptions: readonly { readonly value: string; readonly label: string }[];
};

/** Create paint mutators for the selected Kiwi nodes. */
export function usePaintEditor(kind: PaintListKind): PaintEditor {
  const { resources, updateSelectedNodes, updateSelectedNodesWithImages } = useFigEditor();
  const uploadTargetRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageOptions = [...resources.images.keys()].map((ref) => ({ value: ref, label: ref }));

  const updatePaint = useCallback((index: number, updater: Parameters<typeof replacePaint>[2]): void => {
    updateSelectedNodes(
      (node) => writePaintList(node, kind, replacePaint(paintList(node, kind), index, updater)),
      FIG_NODE_MUTATION_SOURCE.propertyPanel,
    );
  }, [kind, updateSelectedNodes]);

  const addPaintItem = useCallback((): void => {
    updateSelectedNodes(
      (node) => writePaintList(node, kind, addPaint(paintList(node, kind))),
      FIG_NODE_MUTATION_SOURCE.propertyPanel,
    );
  }, [kind, updateSelectedNodes]);

  const removePaintItem = useCallback((index: number): void => {
    updateSelectedNodes(
      (node) => writePaintList(node, kind, removePaint(paintList(node, kind), index)),
      FIG_NODE_MUTATION_SOURCE.propertyPanel,
    );
  }, [kind, updateSelectedNodes]);

  const startImageUpload = useCallback((index: number): void => {
    uploadTargetRef.current = index;
    fileInputRef.current?.click();
  }, []);

  const handleImageFileChange = useCallback((event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0];
    const paintIndex = uploadTargetRef.current;
    event.currentTarget.value = "";
    uploadTargetRef.current = null;
    if (file === undefined || paintIndex === null) {
      return;
    }
    void file.arrayBuffer().then((buffer) => {
      const image = createFigImageAsset({
        data: new Uint8Array(buffer),
        mimeType: file.type,
        fileName: file.name,
      });
      updateSelectedNodesWithImages(
        [image],
        (node) => writePaintList(
          node,
          kind,
          replacePaint(paintList(node, kind), paintIndex, (paint) => setImageHashHex(paint, image.ref)),
        ),
        FIG_NODE_MUTATION_SOURCE.propertyPanel,
      );
    });
  }, [kind, updateSelectedNodesWithImages]);

  const handlers: PaintItemHandlers = {
    onTypeChange: (index: number, type: PaintTypeId) => updatePaint(index, (paint) => setPaintType(paint, type)),
    onOpacityChange: (index: number, opacity: number) => updatePaint(index, (paint) => setPaintOpacity(paint, opacity)),
    onColorChange: (index: number, hex: string) => updatePaint(index, (paint) => setPaintColor(paint, hex)),
    onImageHashHexChange: (index: number, imageHashHex: string) => updatePaint(index, (paint) => setImageHashHex(paint, imageHashHex)),
    onImageScaleModeChange: (index: number, scaleMode: ImageScaleModeId) => updatePaint(index, (paint) => setImageScaleMode(paint, scaleMode)),
    onImageScaleChange: (index: number, scale: number) => updatePaint(index, (paint) => setImageScale(paint, scale)),
    onImageRotationChange: (index: number, rotationDeg: number) => updatePaint(index, (paint) => setImageRotationDeg(paint, rotationDeg)),
    onStartImageUpload: startImageUpload,
    onGradientStopChange: (index: number, stopIndex: number, stop: GradientStopView) => updatePaint(index, (paint) => setGradientStop(paint, stopIndex, stop)),
    onAddGradientStop: (index: number) => updatePaint(index, addGradientStop),
    onRemoveGradientStop: (index: number, stopIndex: number) => updatePaint(index, (paint) => removeGradientStop(paint, stopIndex)),
    onGradientHandleChange: (index: number, handleIndex: number, handle: GradientHandleView) => updatePaint(index, (paint) => setGradientHandle(paint, handleIndex, handle)),
    onRemove: removePaintItem,
  };

  return {
    handlers,
    handleImageFileChange,
    addPaint: addPaintItem,
    uploadTargetRef,
    fileInputRef,
    imageOptions,
  };
}
