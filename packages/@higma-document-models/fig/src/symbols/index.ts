/** @file Symbol resolution entry point. */

export { resolveConstraintAxis } from "./constraint-axis";

// GRID track sizing — SoT for interpreting the Kiwi `GridTrackSize`
// payload that hangs off each `FigGridTrackPositions` entry.
export {
  interpretGridTrackSize,
  resolveTrackSize,
  computeFlexShare,
  type FigGridTrackSize,
  type FigGridTrackAxisSize,
  type FigGridTrackSizingType,
} from "./grid-track-size";

export {
  getConstraintValue,
  resolveChildConstraints,
  type ChildConstraintResolution,
} from "./resolve-child-constraints";

// Instance resolution — SoT for "INSTANCE → renderable node + children"
export {
  createSymbolResolver,
  type ResolvedInstanceNode,
  type InstanceResolution,
  type SymbolResolver,
  type SymbolResolverInput,
  type ResolvedSymbolTarget,
} from "./symbol-resolver";

export {
  resolveInstanceLayout,
} from "./constraints";

export {
  buildFigStyleRegistry,
  buildFigStyleRegistryFromDocuments,
  resolveNodeStyleIds,
  resolveStyleIdOnMutableNode,
  resolvePaintRef,
  resolveEffectsRef,
  resolveTextStyleRef,
  resolveGridRef,
  resolveStyledPaint,
  resolveStyledEffects,
  resolveStyledTextProperties,
  resolveStyledGrids,
  formatNodeLocator,
  styleRefHasKey,
  styleRefKey,
  styleRefKeys,
} from "./style-registry";

export {
  findVariableConsumptionExpression,
  mergeVariableModeBySetMap,
  resolveVariantOverride,
  type ResolveVariantResult,
} from "./variable-resolution";

export { isVariantSetFrame } from "./variant-set-kiwi";
