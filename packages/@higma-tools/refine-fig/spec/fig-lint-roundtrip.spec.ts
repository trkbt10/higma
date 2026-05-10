/**
 * @file Verify the refine-fig pipeline does not corrupt .fig output.
 *
 * The contract: after running `inventory → scaffold → plan → apply`
 * and serialising the result with `saveFigFile`, the output must
 * still pass `runFigHealthCheck` (the project's authoritative
 * fig-file lint) at the same severity counts as the input.
 *
 * Two flows per fixture:
 *
 *   1. No-op flow — scaffold produces blank decisions (`name: ""`).
 *      `buildPlan` filters every decision out, so apply makes no
 *      semantic changes. This isolates the pure save/load + plan/
 *      apply plumbing: any new lint findings can only come from
 *      refine-fig's serialisation path.
 *
 *   2. Active flow — scaffold's blank names are filled in so plan
 *      actually emits `create-*-proxy`, `bind-*-style`, `rename`,
 *      and (when eligible) `promote-icon-cluster` actions. Only
 *      runs against fixtures that have an internalCanvas plus at
 *      least one fill OR text style proxy template — apply throws
 *      otherwise.
 *
 * The assertion is "no new lint regressions vs baseline", not "zero
 * findings". inherit/inherit.fig has 6 baseline warnings; we accept
 * those but reject anything refine-fig newly introduces.
 *
 * Eligibility list comes from a one-shot probe: only fixtures that
 * baseline-lint cleanly AND expose an internalCanvas. Adding more
 * fixtures means re-running the probe and confirming baseline 0E.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runFigHealthCheck } from "@higma-document-io/fig/lint";
import type { FigHealthReport, LintFinding } from "@higma-document-io/fig/lint";
import { saveFigFile } from "@higma-document-io/fig/roundtrip";
import { guidToString } from "@higma-document-models/fig/domain";
import { loadRefineSource } from "../src/refine-source/load";
import { buildInventory } from "../src/inventory";
import { scaffoldDecisions } from "../src/decisions";
import type { Decisions } from "../src/decisions";
import { buildPlan } from "../src/plan";
import { applyPlan } from "../src/apply";

const FIXTURES_ROOT = resolve(__dirname, "../../../@higma-document-renderers/fig/fixtures");

/**
 * Fixtures that lint cleanly AND have an internalCanvas. The no-op
 * flow runs against every entry; the active flow runs only against
 * fixtures with at least one fill or text style proxy template.
 *
 * "shapes/shapes-template.fig" and the *-corrupt fixtures are
 * intentionally excluded — they fail baseline lint by design and
 * cannot be used to detect refine-fig regressions.
 */
const ELIGIBLE_FIXTURES = [
  "autolayout/autolayout.fig",
  "boolean/boolean.fig",
  "clip-rounded/clip-rounded.fig",
  "clips/clips.fig",
  "components/components.fig",
  "composite/composite.fig",
  "decoration-combo/decoration-combo.fig",
  "effects/effects.fig",
  "effects/effects-created.fig",
  "frame-properties/frame-properties.fig",
  "group/group.fig",
  "image-fill/image-fill.fig",
  "image-scale-modes/image-scale-modes.fig",
  "inherit/inherit.fig",
  "mask-and-vector/mask-and-vector.fig",
  "paint-advanced/paint-advanced.fig",
  "rectangle/rectangle.fig",
  "section/section.fig",
  "shapes/shapes.fig",
  "stroke-styles/stroke-styles.fig",
  "symbol-resolution/symbol-resolution.fig",
  "text-styling/text-styling.fig",
  "vector-winding/vector-winding.fig",
] as const;

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

async function readFixtureBytes(rel: string): Promise<Uint8Array> {
  const buf = await readFile(resolve(FIXTURES_ROOT, rel));
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

async function runApplyAndSave(bytes: Uint8Array, fillDecisions: boolean): Promise<Uint8Array> {
  const source = await loadRefineSource(bytes);
  if (!source.internalCanvas) {
    throw new Error("fixture has no internalCanvas — not eligible for apply");
  }
  const inventory = await buildInventory(source, { figPath: "<test>", skipClusters: false });
  const decisions = decisionsForFlow(inventory, fillDecisions);
  const plan = buildPlan(source, inventory, decisions, {
    file: "<test>",
    bytes: bytes.byteLength,
  });
  applyPlan(source.loaded, plan, {
    internalCanvasGuid: guidToString(source.internalCanvas.guid),
    fillTemplateGuid: firstProxyGuid(source.fillStyleProxies),
    textTemplateGuid: firstProxyGuid(source.textStyleProxies),
  });
  return saveFigFile(source.loaded);
}

function firstProxyGuid(proxies: Awaited<ReturnType<typeof loadRefineSource>>["fillStyleProxies"]): string | undefined {
  const head = proxies[0];
  if (!head) {
    return undefined;
  }
  return guidToString(head.guid);
}

function decisionsForFlow(inventory: Awaited<ReturnType<typeof buildInventory>>, active: boolean): Decisions {
  const blank = scaffoldDecisions(inventory);
  if (!active) {
    return blank;
  }
  return saturateDecisions(blank);
}

/**
 * Replace every blank decision name with a deterministic placeholder
 * so plan actually emits actions. Names are derived from the keys to
 * keep the output reproducible.
 */
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

function expectNoNewFindings(after: FigHealthReport, baseline: FigHealthReport, label: string): void {
  const regressions = diffNewFindings(countByRule(after.findings), countByRule(baseline.findings));
  if (regressions.length > 0) {
    const detail = regressions
      .map((r) => `  +${r.delta} ${r.key}`)
      .join("\n");
    throw new Error(`${label}: refine-fig output introduced new lint findings vs baseline:\n${detail}`);
  }
  expect(after.summary.errors).toBeLessThanOrEqual(baseline.summary.errors);
}

describe("refine-fig pipeline preserves fig-lint health", () => {
  for (const rel of ELIGIBLE_FIXTURES) {
    describe(rel, () => {
      it(
        "no-op apply leaves fig-lint findings unchanged",
        async () => {
          const bytes = await readFixtureBytes(rel);
          const baseline = await runFigHealthCheck(bytes);
          expect(baseline.summary.errors, `baseline must be clean: ${rel}`).toBe(0);

          const out = await runApplyAndSave(bytes, false);
          const after = await runFigHealthCheck(out);
          expectNoNewFindings(after, baseline, `${rel} [no-op]`);
        },
        // Cluster detection in `buildInventory` is O(n²) over top-level
        // frames; on the larger fixtures (components, symbol-resolution)
        // a single run can take 10–15s. Give every case the same
        // generous budget rather than tuning per fixture.
        60_000,
      );
    });
  }
});

describe("refine-fig active apply preserves fig-lint health", () => {
  /** Only fixtures with at least one style proxy template can run the
   * active flow without apply skipping every create-*-proxy action. */
  const ACTIVE_FIXTURES = ["inherit/inherit.fig"] as const;

  for (const rel of ACTIVE_FIXTURES) {
    it(
      `${rel}: active apply (proxy + bind + rename) leaves no new lint findings`,
      async () => {
        const bytes = await readFixtureBytes(rel);
        const baseline = await runFigHealthCheck(bytes);
        expect(baseline.summary.errors, `baseline must be clean: ${rel}`).toBe(0);

        const out = await runApplyAndSave(bytes, true);
        const after = await runFigHealthCheck(out);
        expectNoNewFindings(after, baseline, `${rel} [active]`);
      },
      60_000,
    );
  }
});
