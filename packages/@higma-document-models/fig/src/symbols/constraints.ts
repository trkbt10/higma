/**
 * @file Constraint resolution for INSTANCE nodes.
 *
 * When an INSTANCE is resized relative to its SYMBOL, child positions
 * and sizes must be adjusted according to their constraint settings.
 *
 * Per-child constraint math lives in `resolve-child-constraints`.
 * This module keeps the INSTANCE-level decision in SymbolResolver's domain:
 * derivedSymbolData, when applicable to local children, is authoritative;
 * otherwise the Kiwi constraint fields are authoritative.
 */

import type { FigNode, MutableFigNode } from "@higma-document-models/fig/types";
import { CONSTRAINT_TYPE_VALUES } from "@higma-document-models/fig/constants";
import { guidToString } from "@higma-document-models/fig/domain";
import { getConstraintValue, resolveChildConstraints } from "@higma-document-models/fig/symbols";
import { kiwiSymbolOverrideCarriesGeometry } from "./kiwi-override-geometry";
import type { FigDerivedSymbolData } from "./symbol-resolver";

// =============================================================================
// Apply constraints to children
// =============================================================================

/**
 * Apply constraint resolution to direct children of a symbol/instance.
 *
 * Only processes depth-1 children (not recursive). Each child's
 * horizontalConstraint and verticalConstraint determine how its
 * position and size adjust when the parent is resized.
 *
 * @param children     Cloned children from the SYMBOL
 * @param symbolSize   Original SYMBOL size { x, y }
 * @param instanceSize Actual INSTANCE size { x, y }
 * @returns New array of children with adjusted transforms and sizes
 */
export function applyConstraintsToChildren(
  children: readonly FigNode[],
  symbolSize: { x: number; y: number },
  instanceSize: { x: number; y: number },
): readonly FigNode[] {
  return children.map((child) => {
    if (!hasNonMinConstraint(child)) {return child;}
    const resolution = resolveChildConstraints(child, symbolSize, instanceSize);

    return applyConstraintResolution(child, resolution);
  });
}

// =============================================================================
// Instance layout resolution
// =============================================================================

/**
 * Check whether derivedSymbolData entries reference GUIDs that actually
 * exist among the given children. Exported .fig files may carry
 * derivedSymbolData referencing external component library GUIDs that
 * don't exist in this file (orphaned entries).
 */
function isDerivedDataApplicable(derivedSymbolData: FigDerivedSymbolData, children: readonly FigNode[]): boolean {
  return derivedSymbolData.some((entry) => {
    const firstGuid = entry.guidPath?.guids?.[0];
    if (!firstGuid) {return false;}
    const key = guidToString(firstGuid);
    return children.some((child) => {
      return child.guid != null && guidToString(child.guid) === key;
    });
  });
}

function childGuidKey(child: FigNode): string | undefined {
  if (child.guid === undefined) {
    return undefined;
  }
  return guidToString(child.guid);
}

function hasNonMinConstraint(child: FigNode): boolean {
  return (
    getConstraintValue(child.horizontalConstraint) !== CONSTRAINT_TYPE_VALUES.MIN ||
    getConstraintValue(child.verticalConstraint) !== CONSTRAINT_TYPE_VALUES.MIN
  );
}

function requireChildTransform(child: FigNode): NonNullable<FigNode["transform"]> {
  if (child.transform === undefined) {
    throw new Error("Constraint resolution requires child.transform");
  }
  return child.transform;
}

function applyConstraintResolution(
  child: FigNode,
  resolution: ReturnType<typeof resolveChildConstraints>,
): FigNode {
  if (!resolution.posChanged && !resolution.sizeChanged) {return child;}
  const result: MutableFigNode = {
    ...child,
    transform: {
      ...requireChildTransform(child),
      m02: resolution.posX,
      m12: resolution.posY,
    },
    size: {
      x: resolution.dimX,
      y: resolution.dimY,
    },
  };

  if (resolution.sizeChanged) {
    result.fillGeometry = undefined;
    result.strokeGeometry = undefined;
  }

  return result;
}

/**
 * Clear fillGeometry/strokeGeometry on children whose size was changed by
 * derivedSymbolData. Once size changes, the stale baked geometry no longer
 * matches the Kiwi node rectangle.
 */
function clearDerivedGeometry(
  derivedSymbolData: FigDerivedSymbolData,
  children: readonly FigNode[],
): { readonly children: readonly FigNode[]; readonly matched: ReadonlySet<string> } {
  const matched = new Set<string>();
  const geometryAuthored = new Set<string>();
  for (const entry of derivedSymbolData) {
    const targetGuid = entry.guidPath?.guids?.[entry.guidPath.guids.length - 1];
    if (!targetGuid) {continue;}
    const targetKey = guidToString(targetGuid);
    if (entry.size) {
      matched.add(targetKey);
    }
    if (kiwiSymbolOverrideCarriesGeometry(entry)) {
      geometryAuthored.add(targetKey);
    }
  }
  return {
    children: children.map((child) => {
      const key = childGuidKey(child);
      if (key === undefined || !matched.has(key)) {
        return child;
      }
      if (geometryAuthored.has(key)) {
        return child;
      }
      if (child.fillGeometry === undefined && child.strokeGeometry === undefined) {
        return child;
      }
      return {
        ...child,
        fillGeometry: undefined,
        strokeGeometry: undefined,
      };
    }),
    matched,
  };
}

/**
 * Result of instance layout resolution.
 */
export type InstanceLayoutResult = {
  /** Adjusted children array */
  readonly children: readonly FigNode[];
  /** Whether instance size should be applied to the merged node */
  readonly sizeApplied: boolean;
};

/**
 * Resolve layout for a resized INSTANCE's children.
 *
 * Resolution order:
 * 1. If derivedSymbolData exists and its GUIDs match actual children,
 *    Figma has pre-computed the layout; preserve those children and apply
 *    Kiwi constraints only to uncovered children.
 * 2. If no local derivedSymbolData applies, use Kiwi constraint fields.
 *
 * @param children           Cloned children (overrides already applied)
 * @param symbolSize         Original SYMBOL size
 * @param instanceSize       Actual INSTANCE size
 * @param derivedSymbolData  Pre-computed layout data (may be orphaned)
 */
export function resolveInstanceLayout(
  { children, symbolSize, instanceSize, derivedSymbolData }: { children: readonly FigNode[]; symbolSize: { x: number; y: number }; instanceSize: { x: number; y: number }; derivedSymbolData: FigDerivedSymbolData | undefined; }
): InstanceLayoutResult {
  if (derivedSymbolData && derivedSymbolData.length > 0 && isDerivedDataApplicable(derivedSymbolData, children)) {
    const cleared = clearDerivedGeometry(derivedSymbolData, children);
    const supplemented = supplementConstraints({ children: cleared.children, symbolSize, instanceSize, coveredGuids: cleared.matched });
    return { children: supplemented, sizeApplied: true };
  }

  if (children.some(hasNonMinConstraint)) {
    return {
      children: applyConstraintsToChildren(children, symbolSize, instanceSize),
      sizeApplied: true,
    };
  }

  return { children, sizeApplied: false };
}

/**
 * Apply Kiwi constraint resolution to children not covered by
 * derivedSymbolData. Covered children keep Figma's pre-computed values.
 */
function supplementConstraints(
  { children, symbolSize, instanceSize, coveredGuids }: { children: readonly FigNode[]; symbolSize: { x: number; y: number }; instanceSize: { x: number; y: number }; coveredGuids: ReadonlySet<string>; }
): readonly FigNode[] {
  return children.map((child) => {
    const guidKey = childGuidKey(child);

    if (guidKey && coveredGuids.has(guidKey)) {return child;}

    if (!hasNonMinConstraint(child)) {return child;}

    const resolution = resolveChildConstraints(child, symbolSize, instanceSize);
    return applyConstraintResolution(child, resolution);
  });
}
