/**
 * @file Regression test against the canonical "corrupt" fig fixture.
 *
 * `spec/fixtures/corrupt-multi.fig` is a deterministically-built
 * fig file that intentionally trips four distinct fig-lint error
 * classes at once:
 *
 *   - `fig.zip.thumbnail`       (no thumbnail.png in the ZIP)
 *   - `fig.canvas.internal-only` (no Internal Only Canvas node)
 *   - `fig.shape.stroke-fields`  (no strokeWeight/Align/Join on shapes)
 *   - `fig.shape.fill-geometry`  (visible shape has no fillGeometry)
 *
 * The test pins exactly which rule IDs fire so a regression that
 * silences any one of them — or accidentally fires a new one —
 * surfaces here. Use `bun packages/@higma-document-io/fig/spec/fixtures/build-corrupt-fig.ts`
 * to regenerate the fixture if the corruption strategy itself changes.
 */

import fs from "node:fs";
import path from "node:path";
import { runFigHealthCheck } from "../src/lint/health-check";
import type { LintRuleId } from "../src/lint/types";

const FIXTURE = path.join(__dirname, "fixtures", "corrupt-multi.fig");

function uniqueRuleIds(findings: readonly { ruleId: LintRuleId }[]): readonly LintRuleId[] {
  return [...new Set(findings.map((f) => f.ruleId))].sort();
}

describe("corrupt-multi.fig", () => {
  it("trips every fig-lint error class the fixture is designed to surface", async () => {
    const bytes = new Uint8Array(fs.readFileSync(FIXTURE));
    const report = await runFigHealthCheck(bytes);

    expect(report.valid).toBe(false);
    expect(report.summary.errors).toBeGreaterThan(0);

    const ruleIds = uniqueRuleIds(report.findings);
    expect(ruleIds).toEqual([
      "fig.canvas.internal-only",
      "fig.shape.fill-geometry",
      "fig.shape.stroke-fields",
      "fig.zip.thumbnail",
    ]);
  });

  it("fires exactly one fig.canvas.internal-only finding (one missing canvas)", async () => {
    const bytes = new Uint8Array(fs.readFileSync(FIXTURE));
    const report = await runFigHealthCheck(bytes);

    const internalCanvas = report.findings.filter((f) => f.ruleId === "fig.canvas.internal-only");
    expect(internalCanvas).toHaveLength(1);
  });

  it("flags the rect's missing fillGeometry once", async () => {
    const bytes = new Uint8Array(fs.readFileSync(FIXTURE));
    const report = await runFigHealthCheck(bytes);

    const fillGeo = report.findings.filter((f) => f.ruleId === "fig.shape.fill-geometry");
    expect(fillGeo).toHaveLength(1);
    expect(fillGeo[0].path).toContain("ROUNDED_RECTANGLE");
  });

  it("emits three stroke-field findings per affected shape (weight + align + join)", async () => {
    const bytes = new Uint8Array(fs.readFileSync(FIXTURE));
    const report = await runFigHealthCheck(bytes);

    const strokeFields = report.findings.filter((f) => f.ruleId === "fig.shape.stroke-fields");
    expect(strokeFields.length % 3).toBe(0);
    expect(strokeFields.length).toBeGreaterThanOrEqual(6); // FRAME + ROUNDED_RECTANGLE
  });
});
