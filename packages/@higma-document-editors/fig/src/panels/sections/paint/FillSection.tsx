/**
 * @file Fill property section adapter
 *
 * Converts FigPaint fills to the kernel paint view model and wires up
 * mutation callbacks via the shared usePaintEditor hook.
 */

import type { FigDesignNode } from "@higma-document-models/fig/domain";
import type { FigPackageImage } from "@higma-figma-containers/package";
import { FillSectionView } from "@higma-editor-kernel/ui/property-sections";
import type { FigEditorAction } from "../../../context/fig-editor/types";
import type { PropertyMutationTarget } from "../../properties/property-mutation-target";
import { usePaintEditor } from "./usePaintEditor";
import { figPaintToView } from "./paint-view-adapter";

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
    <FillSectionView
      fills={node.fills.map(figPaintToView)}
      imageOptions={editor.imageOptions}
      fileInputRef={editor.fileInputRef}
      onImageFileChange={editor.handleImageFileChange}
      onAddPaint={editor.addPaint}
      handlers={editor.handlers}
    />
  );
}
