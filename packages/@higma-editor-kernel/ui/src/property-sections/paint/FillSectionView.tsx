/** @file Fill section view (presentational only). */

import { type Ref, type ChangeEvent } from "react";
import { AddIcon } from "../../icons";
import { PaintItemEditorView, type PaintItemEditorViewProps, type PaintItemImageOption } from "./PaintItemEditorView";
import {
  sectionContainerStyle,
  addButtonStyle,
  IMAGE_ACCEPT_TYPES,
} from "./paint-section-styles";
import type { PaintItemView } from "./paint-view-model";

/** Per-item editor handlers, expanded one-to-one to match PaintItemEditorView. */
export type PaintItemHandlers = Omit<
  PaintItemEditorViewProps,
  "paint" | "index" | "labelPrefix" | "imageOptions"
>;

export type FillSectionViewProps = {
  readonly fills: readonly PaintItemView[];
  readonly imageOptions: readonly PaintItemImageOption[];
  readonly fileInputRef: Ref<HTMLInputElement>;
  readonly onImageFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onAddPaint: () => void;
  readonly handlers: PaintItemHandlers;
};

/** Renders the fill paint list with per-item type/color/opacity controls. */
export function FillSectionView({
  fills,
  imageOptions,
  fileInputRef,
  onImageFileChange,
  onAddPaint,
  handlers,
}: FillSectionViewProps) {
  return (
    <div style={sectionContainerStyle}>
      <input
        ref={fileInputRef}
        type="file"
        accept={IMAGE_ACCEPT_TYPES}
        onChange={onImageFileChange}
        style={{ display: "none" }}
      />
      {fills.map((fill, i) => (
        <PaintItemEditorView
          key={i}
          paint={fill}
          index={i}
          labelPrefix="Fill"
          imageOptions={imageOptions}
          {...handlers}
        />
      ))}
      <button type="button" style={addButtonStyle} onClick={onAddPaint}>
        <AddIcon size={12} />
        Add fill
      </button>
    </div>
  );
}
