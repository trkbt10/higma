/**
 * @file Top-level health check that orchestrates the rule pipeline.
 *
 * Build the lint context from raw bytes once, then run every rule
 * against it and accumulate findings. Step-level parse errors
 * generated while building the context are forwarded to the same
 * findings list (severity `error`) so the report contains
 * everything that would prevent Figma from importing the file.
 */

import type { FigHealthReport, FigHealthSummary, LintFinding } from "./types";
import { buildLintContext } from "./context";
import { FIG_LINT_RULES } from "./rules";

function summarise(findings: readonly LintFinding[]): FigHealthSummary {
  return findings.reduce<FigHealthSummary>(
    (acc, finding) => {
      if (finding.severity === "error") {
        return { errors: acc.errors + 1, warnings: acc.warnings, infos: acc.infos };
      }
      if (finding.severity === "warning") {
        return { errors: acc.errors, warnings: acc.warnings + 1, infos: acc.infos };
      }
      return { errors: acc.errors, warnings: acc.warnings, infos: acc.infos + 1 };
    },
    { errors: 0, warnings: 0, infos: 0 },
  );
}

/**
 * Run every lint rule against the supplied .fig bytes and produce
 * a structured report.
 */
export async function runFigHealthCheck(bytes: Uint8Array): Promise<FigHealthReport> {
  const findings: LintFinding[] = [];
  const { context, errors } = await buildLintContext(bytes);
  for (const error of errors) {
    findings.push({
      ruleId: error.ruleId,
      severity: "error",
      path: error.path,
      message: error.message,
    });
  }
  for (const rule of FIG_LINT_RULES) {
    rule(context, (finding) => findings.push(finding));
  }
  const summary = summarise(findings);
  return {
    valid: summary.errors === 0,
    inputBytes: bytes.length,
    findings,
    summary,
  };
}
