/** @file Stroke property section. */
import { memo } from "react";
import { sameKiwiNodeExceptTransform } from "@higma-document-models/fig/domain";
import type { FigNode } from "@higma-document-models/fig/types";
import {
  StrokeSectionView,
  type StrokeAlignId,
  type StrokeCapId,
  type StrokeJoinId,
} from "@higma-editor-kernel/ui/property-sections";
import { FIG_NODE_MUTATION_SOURCE, useFigEditor } from "../../../context/FigEditorContext";
import { sectionStyle, sectionTitleStyle } from "../../properties/PropertyPanel";
import {
  paintList,
  paintToView,
  setStrokeAlign,
  setStrokeCap,
  setStrokeDashes,
  setStrokeJoin,
  strokeAlignName,
  strokeCapName,
  strokeJoinName,
} from "./paint-domain";
import { usePaintEditor } from "./usePaintEditor";

type StrokeSectionProps = {
  readonly node: FigNode;
};

function strokeWeightValue(node: FigNode): number {
  if (typeof node.strokeWeight === "number") {
    return node.strokeWeight;
  }
  return 0;
}

function parseStrokeDashes(value: readonly number[]): readonly number[] {
  if (value.some((part) => !Number.isFinite(part) || part < 0)) {
    throw new Error("Stroke dash pattern requires finite non-negative numbers");
  }
  return value;
}

/** Render Kiwi stroke paints and stroke scalar controls. */
function StrokeSectionContent({ node }: StrokeSectionProps) {
  const { updateSelectedNodes } = useFigEditor();
  const strokes = paintList(node, "stroke");
  const editor = usePaintEditor("stroke");
  return (
    <section style={sectionStyle}>
      <div style={sectionTitleStyle}>Stroke</div>
      <StrokeSectionView
        strokes={strokes.map(paintToView)}
        strokeWeight={strokeWeightValue(node)}
        align={strokeAlignName(node)}
        cap={strokeCapName(node)}
        join={strokeJoinName(node)}
        dashes={node.strokeDashes ?? []}
        imageOptions={editor.imageOptions}
        fileInputRef={editor.fileInputRef}
        onImageFileChange={editor.handleImageFileChange}
        onStrokeWeightChange={(strokeWeight) => updateSelectedNodes((current) => ({ ...current, strokeWeight }), FIG_NODE_MUTATION_SOURCE.propertyPanel)}
        onAlignChange={(strokeAlign: StrokeAlignId) => updateSelectedNodes((current) => setStrokeAlign(current, strokeAlign), FIG_NODE_MUTATION_SOURCE.propertyPanel)}
        onCapChange={(strokeCap: StrokeCapId) => updateSelectedNodes((current) => setStrokeCap(current, strokeCap), FIG_NODE_MUTATION_SOURCE.propertyPanel)}
        onJoinChange={(strokeJoin: StrokeJoinId) => updateSelectedNodes((current) => setStrokeJoin(current, strokeJoin), FIG_NODE_MUTATION_SOURCE.propertyPanel)}
        onDashesChange={(dashes) => updateSelectedNodes((current) => setStrokeDashes(current, parseStrokeDashes(dashes)), FIG_NODE_MUTATION_SOURCE.propertyPanel)}
        onAddPaint={editor.addPaint}
        handlers={editor.handlers}
      />
    </section>
  );
}

function sameStrokeSectionProps(left: StrokeSectionProps, right: StrokeSectionProps): boolean {
  return sameKiwiNodeExceptTransform(left.node, right.node);
}

export const StrokeSection = memo(StrokeSectionContent, sameStrokeSectionProps);
