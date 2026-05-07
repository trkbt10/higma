/**
 * @file Vertical panel composition for editor sidebars.
 */

import type { CSSProperties, ReactNode } from "react";

export type StackedEditorPanelSection = {
  readonly id: string;
  readonly content: ReactNode;
  readonly grow: boolean;
  readonly scrollable: boolean;
  readonly style?: CSSProperties;
};

export type StackedEditorPanelProps = {
  readonly sections: readonly StackedEditorPanelSection[];
  readonly style?: CSSProperties;
};

const stackedEditorPanelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  overflow: "hidden",
};

function sectionFlex(section: StackedEditorPanelSection): CSSProperties["flex"] {
  if (section.grow) {
    return "1 1 0";
  }
  return "0 0 auto";
}

function sectionOverflow(section: StackedEditorPanelSection): CSSProperties["overflowY"] {
  if (section.scrollable) {
    return "auto";
  }
  return "hidden";
}

function sectionMinHeight(section: StackedEditorPanelSection): CSSProperties["minHeight"] {
  if (section.grow) {
    return 0;
  }
  return undefined;
}

function getSectionStyle(section: StackedEditorPanelSection): CSSProperties {
  return {
    flex: sectionFlex(section),
    minHeight: sectionMinHeight(section),
    overflowY: sectionOverflow(section),
    ...section.style,
  };
}

/** Compose fixed and scrollable sidebar sections with stable editor sizing. */
export function StackedEditorPanel({ sections, style }: StackedEditorPanelProps) {
  if (sections.length === 0) {
    throw new Error("StackedEditorPanel requires at least one section");
  }

  return (
    <div style={{ ...stackedEditorPanelStyle, ...style }}>
      {sections.map((section) => (
        <div key={section.id} style={getSectionStyle(section)} data-editor-panel-section={section.id}>
          {section.content}
        </div>
      ))}
    </div>
  );
}
