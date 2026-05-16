/** @file INSTANCE self-override controls adapter. */

import {
  parseId,
  type FigDesignDocument,
  type FigDesignNode,
  type FigNodeId,
  type SymbolOverride,
  guidToString,
} from "@higma-document-models/fig/domain";
import {
  InstanceOverridesSectionView,
  type InstanceOverrideRowView,
} from "@higma-editor-kernel/ui/property-sections";
import type { FigEditorAction } from "../../../context/fig-editor/types";
import { createPropertyPrimaryUpdateAction, type PropertyMutationTarget } from "../../properties/property-mutation-target";

type InstanceOverridesSectionProps = {
  readonly node: FigDesignNode;
  readonly target: PropertyMutationTarget;
  readonly document: FigDesignDocument;
  readonly dispatch: (action: FigEditorAction) => void;
};

const SELF_KEY = "__self__";

/** Edit self-overrides that the renderer already resolves through SymbolOverride SoT. */
export function InstanceOverridesSection({ node, target, document, dispatch }: InstanceOverridesSectionProps) {
  if (node.type !== "INSTANCE" || !node.symbolId) {
    return null;
  }

  const override = findSelfOverride(node);
  const opacityPercent = Math.round((override?.opacity ?? node.opacity) * 100);
  const childTargets = collectOverrideTargets(node, document);

  const childRows: readonly InstanceOverrideRowView[] = childTargets.map((childTarget) => {
    const childOverride = findOverrideByPath(node.overrides ?? [], childTarget.path);
    const childOpacityPercent = Math.round((childOverride?.opacity ?? childTarget.node.opacity) * 100);
    return {
      key: childTarget.path.join("/"),
      label: childTarget.label,
      opacityPercent: childOpacityPercent,
    };
  });

  const targetByKey = new Map(childTargets.map((target) => [target.path.join("/"), target] as const));

  return (
    <InstanceOverridesSectionView
      selfRow={{ key: SELF_KEY, label: "Opacity override", opacityPercent }}
      childRows={childRows}
      onOpacityChange={(key, percent) => {
        const opacity = percent / 100;
        if (key === SELF_KEY) {
          dispatch(createPropertyPrimaryUpdateAction({
            target,
            updater: (current) => updateSelfOverrideOpacity(current, opacity),
          }));
          return;
        }
        const childTarget = targetByKey.get(key);
        if (!childTarget) {
          return;
        }
        dispatch(createPropertyPrimaryUpdateAction({
          target,
          updater: (current) => updatePathOverrideOpacity(current, childTarget.path, opacity),
        }));
      }}
    />
  );
}

type OverrideTarget = {
  readonly path: readonly FigNodeId[];
  readonly node: FigDesignNode;
  readonly label: string;
};

function collectOverrideTargets(node: FigDesignNode, document: FigDesignDocument): readonly OverrideTarget[] {
  if (!node.symbolId) {
    return [];
  }
  const symbol = document.components.get(node.symbolId);
  if (!symbol?.children || symbol.children.length === 0) {
    return [];
  }
  return collectTargetsFromChildren({ children: symbol.children, document, prefix: [], labelPrefix: "" });
}

function collectTargetsFromChildren({
  children,
  document,
  prefix,
  labelPrefix,
}: {
  readonly children: readonly FigDesignNode[];
  readonly document: FigDesignDocument;
  readonly prefix: readonly FigNodeId[];
  readonly labelPrefix: string;
}): readonly OverrideTarget[] {
  return children.flatMap((child) => {
    const path = [...prefix, child.id];
    const label = labelPrefix ? `${labelPrefix} / ${child.name}` : child.name;
    const nestedTargets = collectNestedOverrideTargets({ child, document, prefix: path, labelPrefix: label });
    return [{ path, node: child, label }, ...nestedTargets];
  });
}

function findSelfOverride(node: FigDesignNode): SymbolOverride | undefined {
  return node.overrides?.find((override) => {
    const first = override.guidPath.guids[0];
    if (!first) {
      return false;
    }
    const key = guidToString(first);
    return key === node.symbolId;
  });
}

function updateSelfOverrideOpacity(node: FigDesignNode, opacity: number): FigDesignNode {
  if (node.type !== "INSTANCE" || !node.symbolId) {
    return node;
  }

  const symbolId = node.symbolId;
  const normalized = Math.max(0, Math.min(1, opacity));
  const overrides = node.overrides ?? [];
  const next = overrides.map((override) => {
    if (!targetsSymbolFrame(override, symbolId)) {
      return override;
    }
    return { ...override, opacity: normalized };
  });
  const hasSelfOverride = overrides.some((override) => targetsSymbolFrame(override, symbolId));

  return {
    ...node,
    overrides: hasSelfOverride ? next : [...next, createSelfOverride(symbolId, normalized)],
  };
}

function updatePathOverrideOpacity(
  node: FigDesignNode,
  path: readonly FigNodeId[],
  opacity: number,
): FigDesignNode {
  if (node.type !== "INSTANCE" || !node.symbolId) {
    return node;
  }
  const normalized = Math.max(0, Math.min(1, opacity));
  const overrides = node.overrides ?? [];
  const next = overrides.map((override) => {
    if (!sameGuidPath(override, path)) {
      return override;
    }
    return { ...override, opacity: normalized };
  });
  const hasOverride = overrides.some((override) => sameGuidPath(override, path));
  return {
    ...node,
    overrides: hasOverride ? next : [...next, createPathOverride(path, normalized)],
  };
}

function targetsSymbolFrame(override: SymbolOverride, symbolId: FigNodeId): boolean {
  const first = override.guidPath.guids[0];
  if (!first) {
    return false;
  }
  const key = guidToString(first);
  return key === symbolId;
}

function createSelfOverride(symbolId: FigNodeId, opacity: number): SymbolOverride {
  const parsed = parseId(symbolId);
  return {
    guidPath: { guids: [{ sessionID: parsed.sessionID, localID: parsed.localID }] },
    opacity,
  };
}

function createPathOverride(path: readonly FigNodeId[], opacity: number): SymbolOverride {
  if (path.length === 0) {
    throw new Error("Override path requires at least one target id.");
  }
  return {
    guidPath: {
      guids: path.map((id) => {
        const parsed = parseId(id);
        return { sessionID: parsed.sessionID, localID: parsed.localID };
      }),
    },
    opacity,
  };
}

function findOverrideByPath(overrides: readonly SymbolOverride[], path: readonly FigNodeId[]): SymbolOverride | undefined {
  return overrides.find((override) => sameGuidPath(override, path));
}

function sameGuidPath(override: SymbolOverride, path: readonly FigNodeId[]): boolean {
  const guids = override.guidPath.guids;
  if (guids.length !== path.length) {
    return false;
  }
  return guids.every((guid, index) => {
    const id = path[index];
    if (!id) {
      return false;
    }
    return guidToString(guid) === id;
  });
}

function collectNestedOverrideTargets({
  child,
  document,
  prefix,
  labelPrefix,
}: {
  readonly child: FigDesignNode;
  readonly document: FigDesignDocument;
  readonly prefix: readonly FigNodeId[];
  readonly labelPrefix: string;
}): readonly OverrideTarget[] {
  if (child.type !== "INSTANCE" || !child.symbolId) {
    return [];
  }
  const nestedSymbol = document.components.get(child.symbolId);
  if (!nestedSymbol?.children) {
    return [];
  }
  return collectTargetsFromChildren({ children: nestedSymbol.children, document, prefix, labelPrefix });
}
