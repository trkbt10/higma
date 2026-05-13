/**
 * @file Unit tests for the fig-file health check.
 *
 * The tests exercise the rule pipeline end-to-end against shipped
 * fixtures. They do not stub out any of the parsers — the lint is
 * meant to detect issues caused by exactly that production stack.
 *
 * Synthetic broken inputs are constructed in-test so the suite does
 * not rely on a corrupt fixture sitting in the repo (we just fixed
 * the only such fixture). The healthy fixtures stay as the positive
 * case.
 */

import fs from "node:fs";
import path from "node:path";
import { createEmptyZipPackage, loadZipPackage } from "@higma-primitives/zip";
import { FIG_THUMBNAIL_ZIP_ENTRY } from "@higma-figma-containers/package";
import { runFigHealthCheck } from "./health-check";
import { formatFigHealthReport } from "./format";
import type { LintRuleId } from "./types";

const FIXTURE_ROOT = path.resolve(__dirname, "../../../../@higma-document-renderers/fig/fixtures");

function readFigFixture(rel: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(path.join(FIXTURE_ROOT, rel)));
}

function findingIds(report: { findings: readonly { ruleId: LintRuleId }[] }): readonly LintRuleId[] {
  return report.findings.map((finding) => finding.ruleId);
}

/**
 * Read the healthy section.fig and surgically corrupt it: drop
 * thumbnail.png and rebuild the ZIP. The result mirrors the real
 * defect we fixed in components.fig (missing thumbnail) without
 * requiring a corrupt fixture on disk.
 */
async function buildThumbnailLessFigBytes(): Promise<Uint8Array> {
  const original = readFigFixture("section/section.fig");
  const zip = await loadZipPackage(original);
  const rebuilt = createEmptyZipPackage();
  for (const name of zip.listFiles()) {
    if (name === FIG_THUMBNAIL_ZIP_ENTRY) {
      continue;
    }
    const data = zip.readBinary(name);
    if (data) {
      rebuilt.writeBinary(name, new Uint8Array(data));
    }
  }
  const buffer = await rebuilt.toArrayBuffer({ compressionLevel: 6 });
  return new Uint8Array(buffer);
}

describe("runFigHealthCheck", () => {
  it("reports a synthetic thumbnail-less fig as INVALID with the expected rule", async () => {
    const bytes = await buildThumbnailLessFigBytes();
    const report = await runFigHealthCheck(bytes);

    expect(report.valid).toBe(false);
    expect(findingIds(report)).toContain("fig.zip.thumbnail");
  });

  it("returns VALID for a real Figma export (inherit.fig, with version warning only)", async () => {
    const bytes = readFigFixture("inherit/inherit.fig");
    const report = await runFigHealthCheck(bytes);

    expect(report.valid).toBe(true);
    expect(report.summary.errors).toBe(0);
    // Real Figma uses header version "j" today; our reference uses "e". Warning is fine.
    expect(findingIds(report)).toContain("fig.canvas.version");
  });

  it("returns VALID with no findings for the section.fig fixture", async () => {
    const bytes = readFigFixture("section/section.fig");
    const report = await runFigHealthCheck(bytes);

    expect(report.valid).toBe(true);
    expect(report.summary.errors).toBe(0);
    expect(report.summary.warnings).toBe(0);
  });

  it("returns VALID for the repaired components.fig fixture", async () => {
    const bytes = readFigFixture("components/components.fig");
    const report = await runFigHealthCheck(bytes);

    expect(report.valid).toBe(true);
    expect(report.summary.errors).toBe(0);
  });

  it("reports a parse error when the input is not a fig file at all", async () => {
    const bytes = new TextEncoder().encode("definitely not a fig file");
    const report = await runFigHealthCheck(bytes);

    expect(report.valid).toBe(false);
    expect(findingIds(report)).toContain("fig.canvas.header");
  });

  it("formats reports as text and JSON", async () => {
    const bytes = await buildThumbnailLessFigBytes();
    const report = await runFigHealthCheck(bytes);

    const text = formatFigHealthReport(report, { inputLabel: "synthetic.fig", format: "text" });
    expect(text).toContain("status:  INVALID");
    expect(text).toContain("fig.zip.thumbnail");

    const json = formatFigHealthReport(report, { inputLabel: "synthetic.fig", format: "json" });
    const parsed = JSON.parse(json) as { valid: boolean; summary: { errors: number } };
    expect(parsed.valid).toBe(false);
    expect(parsed.summary.errors).toBeGreaterThan(0);
  });
});
