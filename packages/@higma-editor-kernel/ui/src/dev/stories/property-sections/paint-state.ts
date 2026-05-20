/** @file Lightweight stateful paint editor used by stories. */

import { useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type {
  PaintItemHandlers,
  PaintItemImageOption,
  PaintItemView,
} from "../../../property-sections";

export type PaintEditorState = {
  readonly paints: readonly PaintItemView[];
  readonly handlers: PaintItemHandlers;
  readonly imageOptions: readonly PaintItemImageOption[];
  readonly fileInputRef: React.RefObject<HTMLInputElement | null>;
  readonly onImageFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly addPaint: () => void;
};

const DEFAULT_HEX = "#888888";

function createDefaultPaint(): PaintItemView {
  return { type: "SOLID", hex: DEFAULT_HEX, opacity: 1 };
}

const STORY_IMAGE_OPTIONS: readonly PaintItemImageOption[] = [
  { value: "", label: "No image" },
  { value: "demo-image-1", label: "demo-image-1" },
  { value: "demo-image-2", label: "demo-image-2" },
];

/** Returns a paint-editor state suitable for stories — keeps a local list of paints and wires standard handlers. */
export function usePaintEditorState(initial: readonly PaintItemView[]): PaintEditorState {
  const [paints, setPaints] = useState<readonly PaintItemView[]>(initial);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const updatePaint = (index: number, updater: (paint: PaintItemView) => PaintItemView) => {
    setPaints((current) => current.map((paint, i) => i === index ? updater(paint) : paint));
  };

  const handlers: PaintItemHandlers = useMemo(() => ({
    onTypeChange: (index, type) => {
      updatePaint(index, (paint) => {
        if (type === paint.type) {
          return paint;
        }
        if (type === "IMAGE") {
          return {
            type,
            hex: paint.hex,
            opacity: paint.opacity,
            image: { imageHashHex: "", scaleMode: "FILL", scale: 1, rotationDeg: 0 },
          };
        }
        if (type.startsWith("GRADIENT_")) {
          return {
            type,
            hex: paint.hex,
            opacity: paint.opacity,
            gradient: {
              stops: [
                { position: 0, hex: "#000000", alpha: 1 },
                { position: 1, hex: "#ffffff", alpha: 1 },
              ],
              handles: [
                { x: 0, y: 0.5 },
                { x: 1, y: 0.5 },
                { x: 0, y: 1 },
              ],
            },
          };
        }
        return { type, hex: paint.hex, opacity: paint.opacity };
      });
    },
    onOpacityChange: (index, opacity) => updatePaint(index, (paint) => ({ ...paint, opacity })),
    onColorChange: (index, hex) => updatePaint(index, (paint) => ({ ...paint, hex })),
    onImageHashHexChange: (index, imageHashHex) => updatePaint(index, (paint) => paint.image ? ({ ...paint, image: { ...paint.image, imageHashHex } }) : paint),
    onImageScaleModeChange: (index, scaleMode) => updatePaint(index, (paint) => paint.image ? ({ ...paint, image: { ...paint.image, scaleMode } }) : paint),
    onImageScaleChange: (index, scale) => updatePaint(index, (paint) => paint.image ? ({ ...paint, image: { ...paint.image, scale } }) : paint),
    onImageRotationChange: (index, rotationDeg) => updatePaint(index, (paint) => paint.image ? ({ ...paint, image: { ...paint.image, rotationDeg } }) : paint),
    onStartImageUpload: () => fileInputRef.current?.click(),
    onGradientStopChange: (index, stopIndex, stop) => updatePaint(index, (paint) => {
      if (!paint.gradient) {
        return paint;
      }
      const stops = paint.gradient.stops.map((existing, i) => i === stopIndex ? stop : existing);
      return { ...paint, gradient: { ...paint.gradient, stops } };
    }),
    onAddGradientStop: (index) => updatePaint(index, (paint) => {
      if (!paint.gradient) {
        return paint;
      }
      const stops = paint.gradient.stops;
      const first = stops[0]?.position ?? 0;
      const last = stops[stops.length - 1]?.position ?? 1;
      return {
        ...paint,
        gradient: {
          ...paint.gradient,
          stops: [...stops, { position: (first + last) / 2, hex: "#7a7a7a", alpha: 1 }],
        },
      };
    }),
    onRemoveGradientStop: (index, stopIndex) => updatePaint(index, (paint) => {
      if (!paint.gradient || paint.gradient.stops.length <= 2) {
        return paint;
      }
      return {
        ...paint,
        gradient: {
          ...paint.gradient,
          stops: paint.gradient.stops.filter((_, i) => i !== stopIndex),
        },
      };
    }),
    onGradientHandleChange: (index, handleIndex, handle) => updatePaint(index, (paint) => {
      if (!paint.gradient) {
        return paint;
      }
      const handles = paint.gradient.handles.map((existing, i) => i === handleIndex ? handle : existing);
      return { ...paint, gradient: { ...paint.gradient, handles } };
    }),
    onRemove: (index) => setPaints((current) => current.filter((_, i) => i !== index)),
  }), []);

  const addPaint = () => setPaints((current) => [...current, createDefaultPaint()]);

  return {
    paints,
    handlers,
    imageOptions: STORY_IMAGE_OPTIONS,
    fileInputRef,
    onImageFileChange: () => {},
    addPaint,
  };
}
