/** @file INSTANCE override controls over Kiwi symbolData. */
import { memo } from "react";
import { getNodeType, guidToString, sameKiwiNodeExceptTransform } from "@higma-document-models/fig/domain";
import type { FigGuid, FigKiwiSymbolOverride, FigNode } from "@higma-document-models/fig/types";
import {
  InstanceOverridesSectionView,
  type InstanceOverrideRowView,
} from "@higma-editor-kernel/ui/property-sections";
import { FIG_NODE_MUTATION_SOURCE, useFigEditor } from "../../../context/FigEditorContext";
import { sectionStyle, sectionTitleStyle } from "../../properties/PropertyPanel";

type OverrideTarget = {
  readonly key: string;
  readonly path: readonly FigGuid[];
  readonly node: FigNode;
  readonly label: string;
};

type InstanceOverridesSectionProps = {
  readonly node: FigNode;
};

function sameGuid(left: FigGuid, right: FigGuid): boolean {
  return left.sessionID === right.sessionID && left.localID === right.localID;
}

function sameGuidPath(left: readonly FigGuid[], right: readonly FigGuid[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((guid, index) => {
    const other = right[index];
    if (other === undefined) {
      return false;
    }
    return sameGuid(guid, other);
  });
}

function requireOpacity(value: number | undefined, owner: string): number {
  if (typeof value !== "number") {
    throw new Error(`${owner} is missing Kiwi opacity`);
  }
  return value;
}

function opacityPercent(value: number | undefined, owner: string): number {
  return Math.round(requireOpacity(value, owner) * 100);
}

function opacityFromPercent(percent: number): number {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new Error(`Opacity percent must be between 0 and 100, got ${percent}`);
  }
  return percent / 100;
}

function overrideForPath(
  overrides: readonly FigKiwiSymbolOverride[],
  path: readonly FigGuid[],
): FigKiwiSymbolOverride | undefined {
  return overrides.find((override) => {
    const guids = override.guidPath?.guids;
    if (guids === undefined) {
      return false;
    }
    return sameGuidPath(guids, path);
  });
}

function targetLabel(labelPrefix: string, node: FigNode): string {
  if (node.name === undefined) {
    throw new Error(`Override target ${guidToString(node.guid)} is missing name`);
  }
  if (labelPrefix.length === 0) {
    return node.name;
  }
  return `${labelPrefix} / ${node.name}`;
}

function collectOverrideTargets({
  nodes,
  childrenOf,
  prefix,
  labelPrefix,
}: {
  readonly nodes: readonly FigNode[];
  readonly childrenOf: (node: FigNode) => readonly FigNode[];
  readonly prefix: readonly FigGuid[];
  readonly labelPrefix: string;
}): readonly OverrideTarget[] {
  return nodes.flatMap((child) => {
    const path = [...prefix, child.guid];
    const label = targetLabel(labelPrefix, child);
    const key = path.map(guidToString).join("/");
    const descendants = collectOverrideTargets({
      nodes: childrenOf(child),
      childrenOf,
      prefix: path,
      labelPrefix: label,
    });
    return [{ key, path, node: child, label }, ...descendants];
  });
}

function childRows(
  targets: readonly OverrideTarget[],
  overrides: readonly FigKiwiSymbolOverride[],
): readonly InstanceOverrideRowView[] {
  return targets.map((target) => {
    const override = overrideForPath(overrides, target.path);
    const owner = `Override target ${guidToString(target.node.guid)}`;
    return {
      key: target.key,
      label: target.label,
      opacityPercent: opacityPercent(override?.opacity ?? target.node.opacity, owner),
    };
  });
}

function upsertOpacityOverride(
  overrides: readonly FigKiwiSymbolOverride[],
  path: readonly FigGuid[],
  opacity: number,
): readonly FigKiwiSymbolOverride[] {
  const hasOverride = overrides.some((override) => {
    const guids = override.guidPath?.guids;
    if (guids === undefined) {
      return false;
    }
    return sameGuidPath(guids, path);
  });
  if (!hasOverride) {
    return [...overrides, { guidPath: { guids: path }, opacity }];
  }
  return overrides.map((override) => {
    const guids = override.guidPath?.guids;
    if (guids === undefined || !sameGuidPath(guids, path)) {
      return override;
    }
    return { ...override, opacity };
  });
}

function writeChildOpacityOverride(
  node: FigNode,
  path: readonly FigGuid[],
  opacity: number,
): FigNode {
  if (getNodeType(node) !== "INSTANCE") {
    throw new Error("Child symbol override updates require an INSTANCE node");
  }
  const symbolData = node.symbolData;
  if (symbolData?.symbolID === undefined) {
    throw new Error(`INSTANCE ${guidToString(node.guid)} is missing symbolData.symbolID`);
  }
  const overrides = symbolData.symbolOverrides ?? [];
  return {
    ...node,
    symbolData: {
      ...symbolData,
      symbolOverrides: upsertOpacityOverride(overrides, path, opacity),
    },
  };
}

function requireTargetByKey(targets: readonly OverrideTarget[], key: string): OverrideTarget {
  const target = targets.find((candidate) => candidate.key === key);
  if (target === undefined) {
    throw new Error(`Override target ${key} is not present on the resolved SYMBOL`);
  }
  return target;
}

/** Render INSTANCE self and descendant opacity overrides from SymbolResolver. */
function InstanceOverridesSectionContent({ node }: InstanceOverridesSectionProps) {
  const { context, updateNode } = useFigEditor();
  if (getNodeType(node) !== "INSTANCE") {
    return null;
  }
  const resolution = context.symbolResolver.resolveReferences(node);
  const symbol = resolution.effectiveSymbol?.node;
  if (symbol === undefined) {
    throw new Error(`InstanceOverridesSection: INSTANCE ${guidToString(node.guid)} does not resolve to a SYMBOL`);
  }
  const targets = collectOverrideTargets({
    nodes: context.document.childrenOf(symbol),
    childrenOf: context.document.childrenOf,
    prefix: [],
    labelPrefix: "",
  });
  const overrides = node.symbolData?.symbolOverrides ?? [];
  const selfKey = guidToString(node.guid);
  return (
    <section style={sectionStyle}>
      <div style={sectionTitleStyle}>Instance</div>
      <InstanceOverridesSectionView
        selfRow={{
          key: selfKey,
          label: "Opacity override",
          opacityPercent: opacityPercent(node.opacity, `INSTANCE ${guidToString(node.guid)}`),
        }}
        childRows={childRows(targets, overrides)}
        onOpacityChange={(key, percent) => {
          const opacity = opacityFromPercent(percent);
          if (key === selfKey) {
            updateNode(node.guid, (current) => ({ ...current, opacity }), FIG_NODE_MUTATION_SOURCE.propertyPanel);
            return;
          }
          const target = requireTargetByKey(targets, key);
          updateNode(node.guid, (current) => writeChildOpacityOverride(current, target.path, opacity), FIG_NODE_MUTATION_SOURCE.propertyPanel);
        }}
      />
    </section>
  );
}

function sameInstanceOverridesSectionProps(
  left: InstanceOverridesSectionProps,
  right: InstanceOverridesSectionProps,
): boolean {
  return sameKiwiNodeExceptTransform(left.node, right.node);
}

export const InstanceOverridesSection = memo(
  InstanceOverridesSectionContent,
  sameInstanceOverridesSectionProps,
);
