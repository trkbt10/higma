/**
 * @file Compute derivedSymbolData for INSTANCE nodes whose size differs
 * from their SYMBOL definition.
 *
 * When an INSTANCE is resized, Figma pre-computes adjusted transforms /
 * sizes for each descendant child based on the SYMBOL's child constraints
 * (`horizontalConstraint`, `verticalConstraint`). The computed result is
 * stored as a `derivedSymbolData` array of `SymbolOverride` entries on the
 * INSTANCE; without these entries Figma falls back to constraint resolution
 * at render time which can produce slow re-layouts on large symbols.
 *
 * Operates on the `FigDesignNode` domain model — input is a
 * resolved `FigDesignDocument`, output is the per-INSTANCE
 * `derivedSymbolData` array consumed by `documentToTree`'s
 * projection to Kiwi.
 */

import type { FigDesignNode, SymbolOverride } from "../domain";
import { parseId } from "../domain";
import type { FigVector, FigGuid } from "../types";
import { resolveChildConstraints } from "../symbols";

const MAX_RECURSION_DEPTH = 8;

function designNodeToConstraintShape(node: FigDesignNode): {
  transform: FigDesignNode["transform"];
  size: FigVector;
  horizontalConstraint?: { value: number; name: string };
  verticalConstraint?: { value: number; name: string };
} {
  return {
    transform: node.transform,
    size: node.size,
    horizontalConstraint: node.layoutConstraints?.horizontalConstraint,
    verticalConstraint: node.layoutConstraints?.verticalConstraint,
  };
}

function nodeIdToGuid(node: FigDesignNode): FigGuid {
  const parsed = parseId(node.id);
  return { sessionID: parsed.sessionID, localID: parsed.localID };
}

function appendDerivedFor(
  child: FigDesignNode,
  guidPrefix: readonly FigGuid[],
  symSize: FigVector,
  instSize: FigVector,
  derived: SymbolOverride[],
  components: ReadonlyMap<string, FigDesignNode>,
  depth: number,
): void {
  if (depth > MAX_RECURSION_DEPTH) { return; }

  // Resolve child constraints under the new instance size.
  const childShape = designNodeToConstraintShape(child);
  const resolution = resolveChildConstraints(
    childShape as Parameters<typeof resolveChildConstraints>[0],
    symSize,
    instSize,
  );
  if (!resolution) { return; }

  const { posChanged, sizeChanged, posX, posY, dimX, dimY } = resolution;
  const childGuid = nodeIdToGuid(child);

  if (posChanged || sizeChanged) {
    derived.push({
      guidPath: { guids: [...guidPrefix, childGuid] },
      transform: {
        m00: child.transform.m00,
        m01: child.transform.m01,
        m02: posX,
        m10: child.transform.m10,
        m11: child.transform.m11,
        m12: posY,
      },
      size: { x: dimX, y: dimY },
    });
  }

  // If this child is itself a resized INSTANCE, recurse into its SYMBOL.
  if (child.type === "INSTANCE" && sizeChanged && child.symbolId !== undefined) {
    const innerSymbol = components.get(child.symbolId);
    if (innerSymbol) {
      const innerSymSize = innerSymbol.size;
      const innerInstSize = { x: dimX, y: dimY };
      for (const innerChild of innerSymbol.children ?? []) {
        appendDerivedFor(
          innerChild,
          [...guidPrefix, childGuid],
          innerSymSize,
          innerInstSize,
          derived,
          components,
          depth + 1,
        );
      }
    }
  }

  // Recurse into this child's own descendants under the same parent
  // (transform/size context unchanged).
  for (const grandchild of child.children ?? []) {
    appendDerivedFor(
      grandchild,
      [...guidPrefix, childGuid],
      symSize,
      instSize,
      derived,
      components,
      depth + 1,
    );
  }
}

/**
 * Given an INSTANCE node and its resolved SYMBOL, compute the
 * `derivedSymbolData` array Figma expects on the INSTANCE.
 *
 * Returns an empty array when the instance size matches the symbol size
 * (no derivation needed) or when no descendant requires adjustment.
 */
export function computeDerivedSymbolData(
  symbol: FigDesignNode,
  instanceSize: FigVector,
  components: ReadonlyMap<string, FigDesignNode>,
): readonly SymbolOverride[] {
  if (symbol.size.x === instanceSize.x && symbol.size.y === instanceSize.y) {
    return [];
  }
  const derived: SymbolOverride[] = [];
  for (const child of symbol.children ?? []) {
    appendDerivedFor(
      child,
      [], // top-level: empty prefix (the SYMBOL's own GUID is implicit)
      symbol.size,
      instanceSize,
      derived,
      components,
      0,
    );
  }
  return derived;
}
