/**
 * @file Runner for full-page (`selector="body"`) round-trip cases.
 *
 * Differs from `spec/cases/run-html-case.ts` in two ways:
 *
 *   1. Fixture HTML lives outside git (see the package `.gitignore`),
 *      so the function auto-skips the test when the file is missing.
 *      A `extract.sh` co-located with each case shows how to
 *      regenerate the fixture from the live URL.
 *   2. The case asserts whole-page structural invariants — viewport
 *      width, frame depth, paragraph host count, viewportLayer
 *      lifts — rather than hand-tuned selector landmarks. Those are
 *      the metrics that prove `inferAutoLayout`,
 *      `liftViewportLayer`, paragraph collapse, and `emitVector`
 *      survive a real page's full DOM.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runHtmlCase, type RunHtmlCaseOptions, type RunHtmlCaseResult } from "../cases/run-html-case";

/**
 * Resolve a `file://` URL or path-like input to an absolute filesystem
 * path and return whether the underlying file exists. Used to gate
 * full-page cases on whether the fixture has been extracted locally
 * (CI does not regenerate fixtures because they are too large to keep
 * deterministic across daily-rotating live sites).
 */
export function fixtureExists(fixture: string | URL): boolean {
  const url = fixture instanceof URL ? fixture : new URL(fixture);
  if (url.protocol === "file:") {
    return existsSync(fileURLToPath(url));
  }
  return existsSync(url.toString());
}

export async function runFullpageCase(options: RunHtmlCaseOptions): Promise<RunHtmlCaseResult> {
  return runHtmlCase(options);
}
