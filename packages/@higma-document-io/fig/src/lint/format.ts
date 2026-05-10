/**
 * @file Render a `FigHealthReport` for human consumption.
 *
 * The CLI uses `formatFigHealthReport` for stdout; tests use the
 * same function to verify CLI output. JSON is also supported for
 * machine consumers (CI gates, editor extensions).
 */

import type { FigHealthReport, LintSeverity } from "./types";

const SEVERITY_GLYPH: Record<LintSeverity, string> = {
  error: "[error]",
  warning: "[warn] ",
  info: "[info] ",
};

const SEVERITY_ORDER: Record<LintSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

export type FigHealthFormat = "text" | "json";

export type FormatFigHealthOptions = {
  readonly inputLabel: string;
  readonly format?: FigHealthFormat;
};

function formatText(report: FigHealthReport, label: string): string {
  const lines: string[] = [];
  lines.push(`fig-health: ${label} (${report.inputBytes} bytes)`);
  const sortedFindings = [...report.findings].sort((a, b) => {
    const sev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sev !== 0) {
      return sev;
    }
    return a.path.localeCompare(b.path);
  });

  if (sortedFindings.length === 0) {
    lines.push("  ✓ no issues detected");
  } else {
    for (const finding of sortedFindings) {
      lines.push(`  ${SEVERITY_GLYPH[finding.severity]} ${finding.ruleId} ${finding.path}`);
      lines.push(`            ${finding.message}`);
      if (finding.remediation) {
        lines.push(`            → ${finding.remediation}`);
      }
    }
  }

  const summaryParts: string[] = [];
  summaryParts.push(`${report.summary.errors} error(s)`);
  summaryParts.push(`${report.summary.warnings} warning(s)`);
  summaryParts.push(`${report.summary.infos} info(s)`);
  lines.push("");
  lines.push(`summary: ${summaryParts.join(", ")}`);
  lines.push(`status:  ${report.valid ? "VALID" : "INVALID"}`);
  return lines.join("\n");
}

/** Render a `FigHealthReport` for human or machine consumption. */
export function formatFigHealthReport(report: FigHealthReport, options: FormatFigHealthOptions): string {
  const format = options.format ?? "text";
  if (format === "json") {
    return JSON.stringify(
      {
        input: options.inputLabel,
        inputBytes: report.inputBytes,
        valid: report.valid,
        summary: report.summary,
        findings: report.findings,
      },
      null,
      2,
    );
  }
  return formatText(report, options.inputLabel);
}
