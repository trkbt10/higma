/**
 * @file Verify the `ensure-internal-canvas` plan action inserts a
 *  fresh CANVAS when the source lacks one, and that the rest of the
 *  pipeline (styleDefinition bootstrap + bind) lands correctly afterwards.
 *
 * The contract: a `.fig` without an Internal Only Canvas must still be
 * processable by refine-fig. The plan layer inserts an ensure action
 * at the head of the plan; the apply layer creates the canvas, records
 * its GUID, and threads it into every subsequent create-*-style-definition
 * action.
 *
 * Fixture strategy: start from `rectangle/rectangle.fig` (already known
 * to lint clean and exercise the bootstrap path), drop its existing
 * Internal Only Canvas before invoking refine-fig, and verify the
 * recovered output still lints clean and contains exactly one
 * Internal Only Canvas with the bootstrapped styleDefinitions parented under it.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runFigHealthCheck } from "@higma-document-io/fig/lint";
import { loadFigFile, saveFigFile } from "@higma-document-io/fig/roundtrip";
import { getNodeType } from "@higma-document-models/fig/domain";
import { loadRefineSource } from "../src/refine-source/load";
import { buildInventory } from "../src/inventory";
import { scaffoldDecisions } from "../src/decisions";
import type { Decisions } from "../src/decisions";
import { buildPlan } from "../src/plan";
import { applyPlan } from "../src/apply";

const FIXTURES_ROOT = resolve(__dirname, "../../../@higma-document-renderers/fig/fixtures");
const FIXTURE = "rectangle/rectangle.fig";

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

type LoadedShape = Awaited<ReturnType<typeof loadFigFile>>;

function guidKey(g: { sessionID: number; localID: number }): string {
  return `${g.sessionID}:${g.localID}`;
}

/**
 * One pass over nodeChanges: add to `drop` every node whose parent is
 * already in `drop`. Returns the new (potentially larger) set. Pure
 * over its inputs so we can iterate until a fixpoint via recursion.
 */
function expandDropSet(loaded: LoadedShape, drop: ReadonlySet<string>): ReadonlySet<string> {
  const next = new Set(drop);
  for (const n of loaded.nodeChanges) {
    const p = n.parentIndex?.guid;
    if (!p) {
      continue;
    }
    if (next.has(guidKey(p))) {
      next.add(guidKey(n.guid));
    }
  }
  return next;
}

function transitiveDropSet(loaded: LoadedShape, seed: ReadonlySet<string>): ReadonlySet<string> {
  const next = expandDropSet(loaded, seed);
  if (next.size === seed.size) {
    return next;
  }
  return transitiveDropSet(loaded, next);
}

/**
 * Strip the Internal Only Canvas (and its children) from a loaded
 * file, returning a fresh byte buffer. Used to coerce a clean fixture
 * into the "no internal canvas" shape that exercises the new action.
 */
async function dropInternalCanvas(bytes: Uint8Array): Promise<Uint8Array> {
  const loaded = await loadFigFile(bytes);
  const internal = loaded.nodeChanges.find(
    (n) => getNodeType(n) === "CANVAS" && n.internalOnly === true,
  );
  if (!internal) {
    throw new Error("dropInternalCanvas: fixture has no internal canvas to drop");
  }
  const drop = transitiveDropSet(loaded, new Set<string>([guidKey(internal.guid)]));
  const filtered = loaded.nodeChanges.filter((n) => !drop.has(guidKey(n.guid)));
  const next = { ...loaded, nodeChanges: filtered };
  return saveFigFile(next);
}

describe("refine-fig ensure-internal-canvas", () => {
  it(
    "creates a fresh Internal Only Canvas when the source has none, lint stays clean",
    async () => {
      const original = await readFile(resolve(FIXTURES_ROOT, FIXTURE));
      const originalBytes = new Uint8Array(original.buffer, original.byteOffset, original.byteLength);
      const baseline = await runFigHealthCheck(originalBytes);
      expect(baseline.summary.errors, `baseline must be clean: ${FIXTURE}`).toBe(0);

      const withoutCanvasBytes = await dropInternalCanvas(originalBytes);

      // Sanity: the prepared input genuinely has no internal canvas.
      const preLoaded = await loadFigFile(withoutCanvasBytes);
      const preInternal = preLoaded.nodeChanges.filter(
        (n) => getNodeType(n) === "CANVAS" && n.internalOnly === true,
      );
      expect(preInternal, "prepared fixture must lack an internal canvas").toHaveLength(0);

      const source = await loadRefineSource(withoutCanvasBytes);
      expect(source.internalCanvas, "refine source must agree there is no internal canvas").toBeUndefined();

      const inventory = await buildInventory(source, { figPath: FIXTURE, skipClusters: true });
      const decisions = saturateDecisions(scaffoldDecisions(inventory));
      const plan = buildPlan(source, inventory, decisions, {
        file: FIXTURE,
        bytes: withoutCanvasBytes.byteLength,
      });

      // Plan must begin with the ensure-internal-canvas action, exactly once.
      const ensureIdx = plan.actions.findIndex((a) => a.kind === "ensure-internal-canvas");
      expect(ensureIdx, "plan must emit ensure-internal-canvas").toBe(0);
      const ensureCount = plan.actions.filter((a) => a.kind === "ensure-internal-canvas").length;
      expect(ensureCount, "ensure-internal-canvas must appear exactly once").toBe(1);

      const result = applyPlan(source.loaded, plan, {
        internalCanvasGuid: undefined,
        userCanvasGuid: undefined,
        fillTemplateGuid: undefined,
        textTemplateGuid: undefined,
      });

      // ensure action must not appear in skipped — it is the precondition
      // for every following create-*-style-definition.
      const ensureSkips = result.skipped.filter((s) => s.action.kind === "ensure-internal-canvas");
      expect(ensureSkips, `ensure must not be skipped: ${JSON.stringify(ensureSkips)}`).toEqual([]);

      // Bootstrap path must still fire for every named palette entry.
      expect(result.fillStyleDefinitionsCreated, "expected at least one bootstrapped FILL styleDefinition").toBeGreaterThan(0);

      const out = await saveFigFile(result.loaded);
      const outLoaded = await loadFigFile(out);
      const postInternal = outLoaded.nodeChanges.filter(
        (n) => getNodeType(n) === "CANVAS" && n.internalOnly === true,
      );
      expect(postInternal, "output must contain exactly one Internal Only Canvas").toHaveLength(1);

      const newCanvas = postInternal[0];
      if (!newCanvas) {
        throw new Error("expected internal canvas in output");
      }
      const newCanvasGuid = `${newCanvas.guid.sessionID}:${newCanvas.guid.localID}`;
      const styleDefinitionsUnderNewCanvas = outLoaded.nodeChanges.filter((n) => {
        const p = n.parentIndex?.guid;
        if (!p) {
          return false;
        }
        return `${p.sessionID}:${p.localID}` === newCanvasGuid && n.styleType?.name === "FILL";
      });
      expect(styleDefinitionsUnderNewCanvas.length, "bootstrapped FILL styleDefinitions must live under the new internal canvas")
        .toBeGreaterThan(0);

      const after = await runFigHealthCheck(out);
      // The fixture-with-canvas-dropped baseline is the right comparison
      // — we removed the canvas before running refine-fig, so any
      // findings introduced by the removal itself are not the action's
      // fault. Compare against the prepared input, not the pristine one.
      const preparedBaseline = await runFigHealthCheck(withoutCanvasBytes);
      const afterByRule = new Map<string, number>();
      for (const f of after.findings) {
        const key = `${f.severity}:${f.ruleId}`;
        afterByRule.set(key, (afterByRule.get(key) ?? 0) + 1);
      }
      const preparedByRule = new Map<string, number>();
      for (const f of preparedBaseline.findings) {
        const key = `${f.severity}:${f.ruleId}`;
        preparedByRule.set(key, (preparedByRule.get(key) ?? 0) + 1);
      }
      const regressions: { key: string; delta: number }[] = [];
      for (const [key, count] of afterByRule) {
        const before = preparedByRule.get(key) ?? 0;
        if (count > before) {
          regressions.push({ key, delta: count - before });
        }
      }
      if (regressions.length > 0) {
        const detail = regressions.map((r) => `  +${r.delta} ${r.key}`).join("\n");
        throw new Error(`ensure-internal-canvas introduced new lint findings:\n${detail}`);
      }
    },
    60_000,
  );

  it("emits no ensure action when source already has an internal canvas", async () => {
    const original = await readFile(resolve(FIXTURES_ROOT, FIXTURE));
    const bytes = new Uint8Array(original.buffer, original.byteOffset, original.byteLength);
    const source = await loadRefineSource(bytes);
    expect(source.internalCanvas, "fixture must have internal canvas").toBeDefined();

    const inventory = await buildInventory(source, { figPath: FIXTURE, skipClusters: true });
    const decisions = saturateDecisions(scaffoldDecisions(inventory));
    const plan = buildPlan(source, inventory, decisions, {
      file: FIXTURE,
      bytes: bytes.byteLength,
    });
    const ensureCount = plan.actions.filter((a) => a.kind === "ensure-internal-canvas").length;
    expect(ensureCount, "must not emit ensure action when canvas exists").toBe(0);
  });

  it("emits no ensure action when source has no canvas AND no work to do", async () => {
    const original = await readFile(resolve(FIXTURES_ROOT, FIXTURE));
    const originalBytes = new Uint8Array(original.buffer, original.byteOffset, original.byteLength);
    const withoutCanvasBytes = await dropInternalCanvas(originalBytes);
    const source = await loadRefineSource(withoutCanvasBytes);
    expect(source.internalCanvas).toBeUndefined();

    const inventory = await buildInventory(source, { figPath: FIXTURE, skipClusters: true });
    // Blank decisions — nothing named, nothing to do.
    const blank = scaffoldDecisions(inventory);
    const plan = buildPlan(source, inventory, blank, {
      file: FIXTURE,
      bytes: withoutCanvasBytes.byteLength,
    });
    expect(plan.actions, "must emit zero actions when nothing is named").toEqual([]);
  });
});
