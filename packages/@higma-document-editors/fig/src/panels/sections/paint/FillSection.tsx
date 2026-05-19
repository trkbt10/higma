/** @file Fill property section. */
import type { FigNode } from "@higma-document-models/fig/types";
import { FillSectionView } from "@higma-editor-kernel/ui/property-sections";
import { sectionStyle, sectionTitleStyle } from "../../properties/PropertyPanel";
import { paintList, paintToView } from "./paint-domain";
import { usePaintEditor } from "./usePaintEditor";

/** Render Kiwi fill paints as editable property controls. */
export function FillSection({ node }: { readonly node: FigNode }) {
  const fills = paintList(node, "fill");
  const editor = usePaintEditor("fill");
  return (
    <section style={sectionStyle}>
      <div style={sectionTitleStyle}>Fill</div>
      <FillSectionView
        fills={fills.map(paintToView)}
        imageOptions={editor.imageOptions}
        fileInputRef={editor.fileInputRef}
        onImageFileChange={editor.handleImageFileChange}
        onAddPaint={editor.addPaint}
        handlers={editor.handlers}
      />
    </section>
  );
}
