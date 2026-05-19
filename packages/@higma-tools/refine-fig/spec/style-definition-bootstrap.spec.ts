/**
 * @file Verify styleDefinition bootstrap (no template available in source) lands a
 *  structurally-valid fig file.
 *
 * The contract: when a fixture carries zero FILL or TEXT style styleDefinitions,
 * `applyPlan` must still create the styleDefinitions the agent named. The
 * resulting `.fig` must round-trip through `saveFigFile` and pass
 * `runFigHealthCheck` at the same severity counts as the unmodified
 * input — bootstrap is supposed to *grow* the file's styleDefinition set, not
 * change anything else's semantics.
 *
 * `rectangle/rectangle.fig` is the chosen subject. Its hierarchy carries
 * SOLID-painted RECTANGLEs with no shared style styleDefinitions, so an active
 * apply must exercise the bootstrap path for both palette and
 * typography (every TEXT node in the file picks up a freshly-built
 * TEXT styleDefinition too).
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runFigHealthCheck } from "@higma-document-io/fig/lint";
import type { FigHealthReport, LintFinding } from "@higma-document-io/fig/lint";
import { loadFigFile, saveFigFile } from "@higma-document-io/fig/roundtrip";
import { guidToString } from "@higma-document-models/fig/domain";
import { loadRefineSource } from "../src/refine-source/load";
import { buildInventory } from "../src/inventory";
import { scaffoldDecisions } from "../src/decisions";
import type { Decisions } from "../src/decisions";
import { buildPlan } from "../src/plan";
import { applyPlan } from "../src/apply";

const FIXTURES_ROOT = resolve(__dirname, "../../../@higma-document-renderers/fig/fixtures");
const FIXTURE = "rectangle/rectangle.fig";

type RuleCount = ReadonlyMap<string, number>;

function countByRule(findings: readonly LintFinding[]): RuleCount {
  return findings.reduce<Map<string, number>>((acc, f) => {
    const key = `${f.severity}:${f.ruleId}`;
    acc.set(key, (acc.get(key) ?? 0) + 1);
    return acc;
  }, new Map());
}

function diffNewFindings(after: RuleCount, baseline: RuleCount): readonly { key: string; delta: number }[] {
  const out: { key: string; delta: number }[] = [];
  for (const [key, count] of after) {
    const before = baseline.get(key) ?? 0;
    if (count > before) {
      out.push({ key, delta: count - before });
    }
  }
  return out;
}

function expectNoNewFindings(after: FigHealthReport, baseline: FigHealthReport, label: string): void {
  const regressions = diffNewFindings(countByRule(after.findings), countByRule(baseline.findings));
  if (regressions.length > 0) {
    const detail = regressions.map((r) => `  +${r.delta} ${r.key}`).join("\n");
    throw new Error(`${label}: refine-fig output introduced new lint findings vs baseline:\n${detail}`);
  }
}

function saturateDecisions(blank: Decisions): Decisions {
  const palette: Record<string, { name: string }> = {};
  for (const key of Object.keys(blank.palette)) {
    palette[key] = { name: `palette/${key}` };
  }
  const typography: Record<string, { name: string }> = {};
  for (const key of Object.keys(blank.typography)) {
    typography[key] = { name: `type/${key}` };
  }
  const clusters: Record<string, { name: string }> = {};
  for (const key of Object.keys(blank.clusters)) {
    clusters[key] = { name: `cluster/${key}` };
  }
  return { palette, typography, clusters };
}

describe("refine-fig styleDefinition bootstrap", () => {
  it(
    "creates fill styleDefinitions in a file with no template, lint stays clean",
    async () => {
      const buf = await readFile(resolve(FIXTURES_ROOT, FIXTURE));
      const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      const baseline = await runFigHealthCheck(bytes);
      expect(baseline.summary.errors, `baseline must be clean: ${FIXTURE}`).toBe(0);

      // Sanity: the fixture genuinely has zero style styleDefinitions before
      // we run, otherwise we are not exercising the bootstrap path.
      const beforeLoaded = await loadFigFile(bytes);
      const beforeFill = beforeLoaded.nodeChanges.filter((n) => n.styleType?.name === "FILL").length;
      const beforeText = beforeLoaded.nodeChanges.filter((n) => n.styleType?.name === "TEXT").length;
      expect(beforeFill, `${FIXTURE} must start with zero FILL styleDefinitions`).toBe(0);
      expect(beforeText, `${FIXTURE} must start with zero TEXT styleDefinitions`).toBe(0);

      const source = await loadRefineSource(bytes);
      if (!source.internalCanvas) {
        throw new Error(`${FIXTURE} has no internalCanvas — not eligible for apply`);
      }
      const inventory = await buildInventory(source, { figPath: FIXTURE, skipClusters: false });
      const decisions = saturateDecisions(scaffoldDecisions(inventory));
      const plan = buildPlan(source, inventory, decisions, {
        file: FIXTURE,
        bytes: bytes.byteLength,
      });
      const result = applyPlan(source.loaded, plan, {
        internalCanvasGuid: guidToString(source.internalCanvas.guid),
        userCanvasGuid: source.userCanvases[0] ? guidToString(source.userCanvases[0].guid) : undefined,
        fillTemplateGuid: undefined,
        textTemplateGuid: undefined,
      });

      // Bootstrap path must have actually fired — the active flow
      // emits one create per named palette / typography entry.
      expect(result.fillStyleDefinitionsCreated, "expected at least one bootstrapped FILL styleDefinition").toBeGreaterThan(0);
      // Typography is optional (some fixtures have no TEXT nodes), so
      // assert via the inventory rather than a hard floor.
      if (inventory.typography.length > 0) {
        expect(result.textStyleDefinitionsCreated, "expected at least one bootstrapped TEXT styleDefinition when TEXT is present")
          .toBeGreaterThan(0);
      }

      // No bootstrap-path action should land in the skipped list.
      const bootstrapSkips = result.skipped.filter(
        (s) =>
          s.action.kind === "create-fill-style-definition" ||
          s.action.kind === "create-text-style-definition" ||
          s.action.kind === "bind-fill-style" ||
          s.action.kind === "bind-text-style",
      );
      expect(bootstrapSkips, `bootstrap path must not skip any create/bind action; got ${JSON.stringify(bootstrapSkips)}`)
        .toEqual([]);

      const out = await saveFigFile(result.loaded);
      const after = await runFigHealthCheck(out);
      expectNoNewFindings(after, baseline, `${FIXTURE} [bootstrap]`);
    },
    60_000,
  );
});
