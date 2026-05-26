/** @file Text node property section over Kiwi textData. */
import { memo } from "react";
import { getNodeType, sameKiwiNodeExceptTransform } from "@higma-document-models/fig/domain";
import type { FigFontName, FigKiwiTextData, FigNode } from "@higma-document-models/fig/types";
import { FIG_NODE_MUTATION_SOURCE, useFigEditor } from "../../../context/FigEditorContext";
import { fieldGridStyle, inputStyle, PropertyField, sectionStyle, sectionTitleStyle } from "../../properties/PropertyPanel";

type TextPropertiesSectionProps = {
  readonly node: FigNode;
};

function requireTextData(node: FigNode): FigKiwiTextData {
  if (node.textData === undefined) {
    throw new Error("TextPropertiesSection requires Kiwi textData on TEXT nodes");
  }
  return node.textData;
}

function readTextFontSize(node: FigNode): number {
  const textData = requireTextData(node);
  const fontSize = textData.fontSize ?? node.fontSize;
  if (fontSize === undefined) {
    throw new Error("TextPropertiesSection requires a Kiwi fontSize on TEXT nodes");
  }
  return fontSize;
}

function readTextFontName(node: FigNode): FigFontName {
  const textData = requireTextData(node);
  const fontName = textData.fontName ?? node.fontName;
  if (fontName === undefined) {
    throw new Error("TextPropertiesSection requires a Kiwi fontName on TEXT nodes");
  }
  return fontName;
}

/** Render text content and base font controls from Kiwi textData. */
function TextPropertiesSectionContent({ node }: TextPropertiesSectionProps) {
  const { updateNode } = useFigEditor();
  if (getNodeType(node) !== "TEXT") {
    return null;
  }
  if (node.guid === undefined) {
    throw new Error("TextPropertiesSection requires a Kiwi node guid");
  }
  const guid = node.guid;
  const textData = requireTextData(node);
  const fontSize = readTextFontSize(node);
  const fontName = readTextFontName(node);
  return (
    <section style={sectionStyle}>
      <div style={sectionTitleStyle}>Text</div>
      <PropertyField label="Characters">
        <textarea
          style={{ ...inputStyle, minHeight: 70, resize: "vertical" }}
          value={textData.characters}
          onChange={(event) => updateNode(guid, (current) => ({
            ...current,
            textData: {
              ...requireTextData(current),
              characters: event.currentTarget.value,
            },
          }), FIG_NODE_MUTATION_SOURCE.propertyPanel)}
        />
      </PropertyField>
      <div style={{ ...fieldGridStyle, marginTop: 8 }}>
        <PropertyField label="Size">
          <input
            style={inputStyle}
            type="number"
            min={1}
            value={fontSize}
            onChange={(event) => updateNode(guid, (current) => {
              const fontSize = Number(event.currentTarget.value);
              return {
                ...current,
                fontSize,
                textData: {
                  ...requireTextData(current),
                  fontSize,
                },
              };
            }, FIG_NODE_MUTATION_SOURCE.propertyPanel)}
          />
        </PropertyField>
        <PropertyField label="Family">
          <input
            style={inputStyle}
            value={fontName.family}
            onChange={(event) => updateNode(guid, (current) => {
              const currentTextData = requireTextData(current);
              const currentFontName = readTextFontName(current);
              const nextFontName = {
                family: event.currentTarget.value,
                style: currentFontName.style,
                postscript: `${event.currentTarget.value}-${currentFontName.style.replace(/\s+/g, "")}`,
              };
              return {
                ...current,
                fontName: nextFontName,
                textData: {
                  ...currentTextData,
                  fontName: nextFontName,
                },
              };
            }, FIG_NODE_MUTATION_SOURCE.propertyPanel)}
          />
        </PropertyField>
      </div>
    </section>
  );
}

function sameTextPropertiesSectionProps(
  left: TextPropertiesSectionProps,
  right: TextPropertiesSectionProps,
): boolean {
  return sameKiwiNodeExceptTransform(left.node, right.node);
}

export const TextPropertiesSection = memo(
  TextPropertiesSectionContent,
  sameTextPropertiesSectionProps,
);
