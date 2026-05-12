/**
 * @file Boolean path operations (union / subtract / intersect / exclude)
 * over SVG path-`d` strings. Pure path-algebra: takes path data in,
 * returns path data out. No document-format knowledge.
 *
 * The Figma scene-graph Kiwi-enum bridge that maps these names to
 * Figma's numeric enum lives in `@higma-document-models/fig/boolean-operation`.
 * Code-emitting tools (`@higma-tools/fig-to-swiftui`, `fig-to-godot`)
 * import the evaluator from this package directly.
 */

import {
  FillRule,
  PathBooleanOperation,
  pathBoolean,
  pathFromPathData,
  pathToPathData,
} from "../vendor/path-bool/index.js";

/** Boolean operation kind shared across consumers. */
export type BooleanOperationType = "UNION" | "SUBTRACT" | "INTERSECT" | "EXCLUDE";

/** Input contour for boolean evaluation: SVG `d` plus its winding rule. */
export type BooleanPathInput = {
  readonly d: string;
  readonly windingRule: "nonzero" | "evenodd";
};

export type BooleanEvaluationError =
  | { readonly reason: "NO_INPUT_PATHS" }
  | { readonly reason: "PATH_EVALUATION_FAILED"; readonly message: string };

export type BooleanEvaluationResult =
  | { readonly ok: true; readonly paths: readonly string[] }
  | { readonly ok: false; readonly error: BooleanEvaluationError };

/** Evaluate boolean operation child paths through the single path-bool adapter. */
export function evaluateBooleanPathResult(
  childPaths: readonly BooleanPathInput[],
  operation: BooleanOperationType,
): BooleanEvaluationResult {
  if (childPaths.length === 0) {
    return { ok: false, error: { reason: "NO_INPUT_PATHS" } };
  }
  if (childPaths.length === 1) {
    return { ok: true, paths: [childPaths[0].d] };
  }

  try {
    return { ok: true, paths: evaluateBooleanPathsUnsafe(childPaths, operation) };
  } catch (error) {
    return { ok: false, error: { reason: "PATH_EVALUATION_FAILED", message: errorToMessage(error) } };
  }
}

/** Evaluate boolean operation child paths and throw if evaluation fails. */
export function evaluateBooleanPaths(
  childPaths: readonly BooleanPathInput[],
  operation: BooleanOperationType,
): readonly string[] {
  const result = evaluateBooleanPathResult(childPaths, operation);
  if (!result.ok) {
    throw new Error(`Boolean path evaluation failed: ${result.error.reason}${"message" in result.error ? `: ${result.error.message}` : ""}`);
  }
  return result.paths;
}

function evaluateBooleanPathsUnsafe(
  childPaths: readonly BooleanPathInput[],
  operation: BooleanOperationType,
): readonly string[] {
  let currentPath = pathFromPathData(childPaths[0].d);
  let currentFillRule = toFillRuleEnum(childPaths[0].windingRule);
  const boolOp = toPathBoolOp(operation);

  for (let i = 1; i < childPaths.length; i += 1) {
    const nextPath = pathFromPathData(childPaths[i].d);
    const nextFillRule = toFillRuleEnum(childPaths[i].windingRule);
    const results = pathBoolean(currentPath, currentFillRule, nextPath, nextFillRule, boolOp);

    if (results.length === 0) {
      if (boolOp === PathBooleanOperation.Difference) {
        continue;
      }
      return [];
    }

    currentPath = resolveNextPath(results);
    currentFillRule = FillRule.NonZero;
  }

  const finalD = pathToPathData(currentPath);
  return finalD.trim().length === 0 ? [] : [finalD];
}

function resolveNextPath(results: readonly ReturnType<typeof pathFromPathData>[]): ReturnType<typeof pathFromPathData> {
  if (results.length === 1) {
    return results[0];
  }
  return pathFromPathData(results.map((p) => pathToPathData(p)).join(" "));
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function toFillRuleEnum(windingRule: "nonzero" | "evenodd"): FillRule {
  return windingRule === "evenodd" ? FillRule.EvenOdd : FillRule.NonZero;
}

function toPathBoolOp(operation: BooleanOperationType): PathBooleanOperation {
  switch (operation) {
    case "UNION": return PathBooleanOperation.Union;
    case "SUBTRACT": return PathBooleanOperation.Difference;
    case "INTERSECT": return PathBooleanOperation.Intersection;
    case "EXCLUDE": return PathBooleanOperation.Exclusion;
  }
}

/** Discriminator helper for callers that read free-form name fields (e.g. Kiwi enum payloads). */
export function isBooleanOperationName(name: string | undefined): name is BooleanOperationType {
  return name === "UNION" || name === "SUBTRACT" || name === "INTERSECT" || name === "EXCLUDE";
}
