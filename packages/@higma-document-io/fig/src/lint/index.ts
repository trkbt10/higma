/**
 * @file Public entry for the fig health-check (lint) library.
 *
 * Consumers compose `runFigHealthCheck` for the structured report
 * and `formatFigHealthReport` for terminal/JSON output. The module
 * is self-contained: it depends only on the existing fig parser,
 * compression, kiwi codec, and zip primitives.
 */

export { runFigHealthCheck } from "./health-check";
export {
  formatFigHealthReport,
  type FigHealthFormat,
  type FormatFigHealthOptions,
} from "./format";
export {
  type FigHealthReport,
  type FigHealthSummary,
  type LintFinding,
  type LintRule,
  type LintRuleId,
  type LintSeverity,
  type LintContext,
} from "./types";
export { FIG_LINT_RULES } from "./rules";
