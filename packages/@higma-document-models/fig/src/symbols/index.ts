/** @file Symbol resolution entry point. */

export { resolveConstraintAxis } from "./constraint-axis";

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
  resolveVariantOverride,
  type ResolveVariantResult,
} from "./variable-resolution";

export { isVariantSetFrame } from "./variant-set-kiwi";
