/** @file Fig node property panel over Kiwi nodes. */
import type { CSSProperties, ReactNode } from "react";
import { getNodeType, guidToString } from "@higma-document-models/fig/domain";
import { InlineRenameInput } from "@higma-editor-kernel/ui";
import { FIG_NODE_MUTATION_SOURCE, useFigEditor } from "../../context/FigEditorContext";
import { PositionSection } from "../sections/appearance/PositionSection";
import { SizeSection } from "../sections/appearance/SizeSection";
import { RotationSection } from "../sections/appearance/RotationSection";
import { OpacitySection } from "../sections/appearance/OpacitySection";
import { CornerRadiusSection } from "../sections/appearance/CornerRadiusSection";
import { FillSection } from "../sections/paint/FillSection";
import { StrokeSection } from "../sections/paint/StrokeSection";
import { EffectsSection } from "../sections/paint/EffectsSection";
import { TextPropertiesSection } from "../sections/text/TextPropertiesSection";
import { AlignmentSection } from "../sections/layout/AlignmentSection";
import { AutoLayoutSection } from "../sections/layout/AutoLayoutSection";
import { LayoutConstraintsSection } from "../sections/layout/LayoutConstraintsSection";
import { ComponentPropertiesSection } from "../sections/component/ComponentPropertiesSection";
import { InstanceOverridesSection } from "../sections/component/InstanceOverridesSection";
import { VariantPropertiesSection } from "../sections/component/VariantPropertiesSection";
import { ComponentSetVariantsSection } from "../sections/component/ComponentSetVariantsSection";
import { ExportSettingsSection } from "../sections/export/ExportSettingsSection";
import { SectionBehaviorSection } from "../sections/structure/SectionBehaviorSection";
import { VectorPathSection } from "../sections/vector/VectorPathSection";
import { OutlineSection } from "../sections/vector/OutlineSection";
import { allowsFigUserOperation } from "../../context/fig-editor/user-operation";
import { useFigOperationDomain } from "../../context/use-fig-operation-domain";

const rootStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  font: "12px system-ui, sans-serif",
};

const headerStyle: CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid #d6dee8",
};

const nameStyle: CSSProperties = {
  fontWeight: 600,
};

const mutationScopeStyle: CSSProperties = {
  border: 0,
  padding: 0,
  margin: 0,
  minWidth: 0,
};

const bodyStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 0,
};

export const sectionStyle: CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid #e2e8f0",
};

export const sectionTitleStyle: CSSProperties = {
  fontWeight: 600,
  marginBottom: 8,
};

export const fieldGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
  gap: 8,
};

/** Render a labeled property input row. */
export function PropertyField({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <label style={{ display: "grid", gap: 4, minWidth: 0 }}>
      <span style={{ color: "#64748b", fontSize: 11 }}>{label}</span>
      {children}
    </label>
  );
}

export const inputStyle: CSSProperties = {
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box",
  border: "1px solid #cbd5e1",
  borderRadius: 4,
  padding: "4px 6px",
  font: "12px system-ui, sans-serif",
};

/** Render editable properties for the primary selected Kiwi node. */
export function PropertyPanel() {
  const { primaryNode, selectedNodes, updateNode } = useFigEditor();
  const operationDomain = useFigOperationDomain();
  const propertyMutationDisabled = !allowsFigUserOperation(operationDomain, "update-property");
  if (primaryNode === undefined) {
    return (
      <section style={rootStyle}>
        <div style={headerStyle}>Properties</div>
        <div style={{ padding: 12, color: "#64748b" }}>No selection</div>
      </section>
    );
  }
  if (primaryNode.guid === undefined) {
    throw new Error("PropertyPanel selected Kiwi node is missing guid");
  }
  const primaryGuid = primaryNode.guid;
  const typeName = getNodeType(primaryNode);
  return (
    <section style={rootStyle}>
      <div style={headerStyle}>
        <InlineRenameInput
          value={primaryNode.name ?? typeName}
          onCommit={(name) => updateNode(primaryGuid, (current) => ({ ...current, name }), FIG_NODE_MUTATION_SOURCE.propertyPanel)}
          disabled={propertyMutationDisabled}
          ariaLabel={`Rename selected ${primaryNode.name ?? typeName}`}
          displayStyle={nameStyle}
        />
        <div style={{ color: "#64748b", marginTop: 2 }}>
          {selectedNodes.length > 1 ? `${selectedNodes.length} selected · ${typeName}` : typeName} · {guidToString(primaryNode.guid)}
        </div>
      </div>
      <fieldset disabled={propertyMutationDisabled} aria-disabled={propertyMutationDisabled} style={mutationScopeStyle}>
        <div style={bodyStyle}>
          <AlignmentSection node={primaryNode} />
          <PositionSection node={primaryNode} />
          <SizeSection node={primaryNode} />
          <RotationSection node={primaryNode} />
          <OpacitySection node={primaryNode} />
          <CornerRadiusSection node={primaryNode} />
          <FillSection node={primaryNode} />
          <StrokeSection node={primaryNode} />
          <EffectsSection node={primaryNode} />
          <TextPropertiesSection node={primaryNode} />
          <AutoLayoutSection node={primaryNode} />
          <LayoutConstraintsSection node={primaryNode} />
          <ComponentPropertiesSection node={primaryNode} />
          <InstanceOverridesSection node={primaryNode} />
          <VariantPropertiesSection node={primaryNode} />
          <ComponentSetVariantsSection node={primaryNode} />
          <SectionBehaviorSection node={primaryNode} />
          <VectorPathSection node={primaryNode} />
          <OutlineSection node={primaryNode} />
          <ExportSettingsSection node={primaryNode} />
        </div>
      </fieldset>
    </section>
  );
}
