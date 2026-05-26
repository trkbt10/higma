/** @file Fill property section. */
import { memo } from "react";
import { sameKiwiNodeExceptTransform } from "@higma-document-models/fig/domain";
import type { FigNode } from "@higma-document-models/fig/types";
import { FillSectionView } from "@higma-editor-kernel/ui/property-sections";
import { sectionStyle, sectionTitleStyle } from "../../properties/PropertyPanel";
import { paintList, paintToView } from "./paint-domain";
import { usePaintEditor } from "./usePaintEditor";

type FillSectionProps = {
  readonly node: FigNode;
};

/** Render Kiwi fill paints as editable property controls. */
function FillSectionContent({ node }: FillSectionProps) {
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

function sameFillSectionProps(left: FillSectionProps, right: FillSectionProps): boolean {
  return sameKiwiNodeExceptTransform(left.node, right.node);
}

export const FillSection = memo(FillSectionContent, sameFillSectionProps);
