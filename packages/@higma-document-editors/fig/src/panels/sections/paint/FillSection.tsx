/**
 * @file Fill property section
 *
 * Edits the fill paints of a selected node.
 * Supports: solid color editing, opacity, add/remove fills.
 */

import type { FigDesignNode } from "@higma-document-models/fig/domain";
import type { FigPackageImage } from "@higma-figma-containers/package";
import type { FigEditorAction } from "../../../context/fig-editor/types";
import type { PropertyMutationTarget } from "../../properties/property-mutation-target";
import { AddIcon } from "@higma-editor-kernel/ui/icons";
import { usePaintEditor } from "./usePaintEditor";
import { PaintItemEditor } from "./PaintItemEditor";
import { sectionContainerStyle, addButtonStyle, IMAGE_ACCEPT_TYPES } from "./paint-section-styles";

type FillSectionProps = {
  readonly node: FigDesignNode;
  readonly target: PropertyMutationTarget;
  readonly images: ReadonlyMap<string, FigPackageImage>;
  readonly dispatch: (action: FigEditorAction) => void;
};

/** Panel section for viewing and editing fill paints of a Figma node. */
export function FillSection({ node, target, images, dispatch }: FillSectionProps) {
  const editor = usePaintEditor({ node, target, images, dispatch, kind: "fill" });

  return (
    <div style={sectionContainerStyle}>
      <input
        ref={editor.fileInputRef}
        type="file"
        accept={IMAGE_ACCEPT_TYPES}
        onChange={editor.handleImageFileChange}
        style={{ display: "none" }}
      />
      {node.fills.map((fill, i) => (
        <PaintItemEditor
          key={i}
          paint={fill}
          index={i}
          labelPrefix="Fill"
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
        Add fill
      </button>
    </div>
  );
}
