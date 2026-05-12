/**
 * @file refine-fig CLI orchestration — currently mid-rebuild.
 *
 * The skill is being rewritten around an `inventory → decisions →
 * plan → apply → verify` flow. While that work lands the only
 * commands wired up are `inventory` (facts about the file) and
 * `verify` (pixel-diff two files frame by frame). The `apply` /
 * `workbench` / `analyze` entry points will be reintroduced once
 * the new pipeline modules are in place.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { loadRefineSource } from "../refine-source/load";
import { saveFigFile } from "@higma-document-io/fig/roundtrip";
import { guidToString } from "@higma-document-models/fig/domain";
import { comparePng } from "@higma-codecs/png-compare";
import { renderFramesViaWorker } from "../visual";
import type { WorkerRenderedFrame } from "../visual";
import { buildInventory } from "../inventory";
import type { Inventory } from "../inventory";
import { scaffoldDecisions, parseDecisions } from "../decisions";
import { buildWorkbench } from "../workbench";
import { buildPlan } from "../plan";
import type { RefinePlan } from "../plan";
import { applyPlan } from "../apply";
import { diffStructure } from "../structure-diff";
import { loadFigFile } from "@higma-document-io/fig/roundtrip";

type Command = "inventory" | "workbench" | "scaffold" | "plan" | "apply" | "verify" | "diff";

type ParsedArgs = {
  readonly command: Command;
  readonly positional: readonly string[];
  readonly options: ReadonlyMap<string, string>;
  readonly flags: ReadonlySet<string>;
};

const COMMANDS: ReadonlySet<Command> = new Set(["inventory", "workbench", "scaffold", "plan", "apply", "verify", "diff"]);

function isCommand(value: string): value is Command {
  return (COMMANDS as ReadonlySet<string>).has(value);
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const command = argv[0];
  if (!command || !isCommand(command)) {
    throw new Error(`refine-fig: unknown command "${command ?? ""}". Expected ${[...COMMANDS].join(" | ")}.`);
  }
  const positional: string[] = [];
  const options = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 1; i < argv.length; i = i + 1) {
    const arg = argv[i];
    if (!arg) {
      continue;
    }
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      flags.add(key);
      continue;
    }
    options.set(key, next);
    i = i + 1;
  }
  return { command, positional, options, flags };
}

function requireOption(args: ParsedArgs, key: string): string {
  const v = args.options.get(key);
  if (!v) {
    throw new Error(`refine-fig: missing required option --${key}`);
  }
  return v;
}

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

async function commandInventory(args: ParsedArgs): Promise<void> {
  const input = args.positional[0];
  if (!input) {
    throw new Error("refine-fig inventory: missing input .fig path");
  }
  const outDir = requireOption(args, "out");
  const skipClusters = args.flags.has("skip-clusters");
  const inputPath = resolve(input);
  const bytes = new Uint8Array(await readFile(inputPath));
  const source = await loadRefineSource(bytes);
  const inventory = await buildInventory(source, { figPath: inputPath, skipClusters });
  await ensureDir(outDir);
  await writeInventory(outDir, basename(inputPath), bytes.byteLength, inventory);
  process.stdout.write(
    `refine-fig inventory: palette=${inventory.palette.length} typography=${inventory.typography.length}`
    + ` clusters=${inventory.subtreeClusters.length} geometryClusters=${inventory.geometryClusters.length}`
    + ` layoutHints=${inventory.layoutHints.length}\n`,
  );
}

type StoredInventory = Inventory & { readonly source: { readonly file: string; readonly bytes: number } };

async function writeInventory(outDir: string, file: string, bytes: number, inventory: Inventory): Promise<void> {
  const stored: StoredInventory = { source: { file, bytes }, ...inventory };
  const path = join(outDir, "inventory.json");
  await writeFile(path, JSON.stringify(stored, null, 2));
}

async function readInventoryFromDisk(outDir: string): Promise<Inventory> {
  const text = await readFile(join(outDir, "inventory.json"), "utf8");
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("refine-fig: inventory.json is not an object");
  }
  // Trust the on-disk inventory shape — it was produced by this CLI
  // in the previous step; validating it again here would duplicate
  // the inventory module's own type contract.
  const inventory = parsed as StoredInventory;
  return {
    palette: inventory.palette,
    typography: inventory.typography,
    subtreeClusters: inventory.subtreeClusters,
    geometryClusters: inventory.geometryClusters ?? [],
    unrenderable: inventory.unrenderable,
    layoutHints: inventory.layoutHints ?? [],
  };
}

async function commandWorkbench(args: ParsedArgs): Promise<void> {
  const input = args.positional[0];
  if (!input) {
    throw new Error("refine-fig workbench: missing input .fig path");
  }
  const inventoryDir = requireOption(args, "inventory");
  const outDir = requireOption(args, "out");
  const inputPath = resolve(input);
  const inventory = await readInventoryFromDisk(resolve(inventoryDir));
  const bytes = new Uint8Array(await readFile(inputPath));
  const source = await loadRefineSource(bytes);
  await ensureDir(outDir);
  const manifest = await buildWorkbench(source, inventory, { outDir, figPath: inputPath });
  await writeFile(join(outDir, "index.json"), JSON.stringify(manifest, null, 2));
  process.stdout.write(
    `refine-fig workbench: clusters=${manifest.clusters.length} palette=${manifest.palette.length} typography=${manifest.typography.length}`
    + (manifest.skipped.renderFailures > 0 ? ` (${manifest.skipped.renderFailures} render failures)` : "")
    + "\n",
  );
}

async function commandScaffold(args: ParsedArgs): Promise<void> {
  const inventoryDir = requireOption(args, "inventory");
  const outFile = requireOption(args, "out");
  const inventory = await readInventoryFromDisk(resolve(inventoryDir));
  const decisions = scaffoldDecisions(inventory);
  await writeFile(resolve(outFile), JSON.stringify(decisions, null, 2));
  process.stdout.write(
    `refine-fig scaffold: clusters=${Object.keys(decisions.clusters).length}`
    + ` palette=${Object.keys(decisions.palette).length}`
    + ` typography=${Object.keys(decisions.typography).length}`
    + ` geometryClusters=${Object.keys(decisions.geometryClusters ?? {}).length}\n`,
  );
}

async function commandPlan(args: ParsedArgs): Promise<void> {
  const input = args.positional[0];
  if (!input) {
    throw new Error("refine-fig plan: missing input .fig path");
  }
  const inventoryDir = requireOption(args, "inventory");
  const decisionsPath = requireOption(args, "decisions");
  const outFile = requireOption(args, "out");
  const inputPath = resolve(input);
  const inventory = await readInventoryFromDisk(resolve(inventoryDir));
  const decisions = parseDecisions(await readFile(resolve(decisionsPath), "utf8"));
  const bytes = new Uint8Array(await readFile(inputPath));
  const source = await loadRefineSource(bytes);
  const plan = buildPlan(source, inventory, decisions, { file: basename(inputPath), bytes: bytes.byteLength });
  await mkdir(dirname(resolve(outFile)), { recursive: true });
  await writeFile(resolve(outFile), JSON.stringify(plan, null, 2));
  process.stdout.write(`refine-fig plan: ${formatPlanSummary(plan)}\n`);
}

function formatPlanSummary(plan: RefinePlan): string {
  const parts: string[] = [`actions=${plan.actions.length}`];
  if (plan.diagnostics.skippedNonPromotableClusters.length > 0) {
    parts.push(`skippedNonPromotableClusters=${plan.diagnostics.skippedNonPromotableClusters.length}`);
  }
  return parts.join(" ");
}

async function commandApply(args: ParsedArgs): Promise<void> {
  const input = args.positional[0];
  if (!input) {
    throw new Error("refine-fig apply: missing input .fig path");
  }
  const planPath = requireOption(args, "plan");
  const outFig = requireOption(args, "out");
  const inputPath = resolve(input);
  const planText = await readFile(resolve(planPath), "utf8");
  const plan: RefinePlan = JSON.parse(planText) as RefinePlan;
  const bytes = new Uint8Array(await readFile(inputPath));
  const source = await loadRefineSource(bytes);
  const ctx = applyContextFromSource(source);
  const result = applyPlan(source.loaded, plan, ctx);
  const out = await saveFigFile(source.loaded);
  await mkdir(dirname(resolve(outFig)), { recursive: true });
  await writeFile(resolve(outFig), out);
  process.stdout.write(
    `refine-fig apply:`
    + (result.internalCanvasCreated ? ` createdInternalCanvas=1` : ``)
    + ` createdFillProxies=${result.fillProxiesCreated}`
    + ` createdTextProxies=${result.textProxiesCreated}`
    + ` boundFill=${result.fillBound}`
    + ` boundText=${result.textBound}`
    + ` clustersPromoted=${result.clustersPromoted}`
    + ` instancesRewritten=${result.instancesRewritten}`
    + ` vectorClustersPromoted=${result.vectorClustersPromoted}`
    + ` vectorInstancesRewritten=${result.vectorInstancesRewritten}`
    + ` variantSetsCreated=${result.variantSetsCreated}`
    + ` layoutsApplied=${result.layoutsApplied}`
    + ` renamed=${result.renamed}`
    + ` skipped=${result.skipped.length}\n`,
  );
}

function applyContextFromSource(
  source: Awaited<ReturnType<typeof loadRefineSource>>,
): { internalCanvasGuid: string | undefined; userCanvasGuid: string | undefined; fillTemplateGuid: string | undefined; textTemplateGuid: string | undefined } {
  // No internal canvas? Leave it undefined — the plan's
  // ensure-internal-canvas action (when present) will create one and
  // the apply layer threads the new guid into every create-*-proxy.
  // If the plan needs proxies but failed to emit the ensure action,
  // apply records that as a skipped action with a clear reason.
  const firstUserCanvas = source.userCanvases[0];
  return {
    internalCanvasGuid: source.internalCanvas ? guidToString(source.internalCanvas.guid) : undefined,
    userCanvasGuid: firstUserCanvas ? guidToString(firstUserCanvas.guid) : undefined,
    fillTemplateGuid: source.fillStyleProxies[0] ? guidToString(source.fillStyleProxies[0].guid) : undefined,
    textTemplateGuid: source.textStyleProxies[0] ? guidToString(source.textStyleProxies[0].guid) : undefined,
  };
}

async function commandDiff(args: ParsedArgs): Promise<void> {
  const before = args.positional[0];
  const after = args.positional[1];
  if (!before || !after) {
    throw new Error("refine-fig diff: usage: diff <before.fig> <after.fig> [--out <report.json>]");
  }
  const beforeBytes = new Uint8Array(await readFile(resolve(before)));
  const afterBytes = new Uint8Array(await readFile(resolve(after)));
  const beforeLoaded = await loadFigFile(beforeBytes);
  const afterLoaded = await loadFigFile(afterBytes);
  const report = diffStructure(beforeLoaded, afterLoaded);
  const outPath = args.options.get("out");
  if (outPath) {
    await mkdir(dirname(resolve(outPath)), { recursive: true });
    await writeFile(resolve(outPath), JSON.stringify(report, null, 2));
  }
  process.stdout.write(
    `refine-fig diff: missing=${report.summary.missing} added=${report.summary.added}`
    + ` parentMoved=${report.summary.parentMoved} typeChanged=${report.summary.typeChanged}`
    + ` imageFillLost=${report.summary.imageFillLost} imageFillOrphan=${report.summary.imageFillOrphan}`
    + ` blobRewired=${report.summary.blobRewired}`
    + (outPath ? ` (full report → ${outPath})` : "")
    + "\n",
  );
}

async function commandVerify(args: ParsedArgs): Promise<void> {
  const before = args.positional[0];
  const after = args.positional[1];
  if (!before || !after) {
    throw new Error("refine-fig verify: usage: verify <before.fig> <after.fig> --out <dir>");
  }
  const outDir = requireOption(args, "out");
  await ensureDir(outDir);
  const onSkip = (label: string) => (name: string, err: unknown): void => {
    process.stdout.write(
      `  [${label}] skipped frame "${name}" — ${err instanceof Error ? err.message : String(err)}\n`,
    );
  };
  // Each render goes through the long-lived subprocess worker so a
  // resvg native panic on one frame restarts the worker rather than
  // killing this process. Verify is the most panic-prone command
  // because it renders both versions of every top-level frame.
  const beforeFrames = await renderFramesViaWorker({ figPath: resolve(before), onSkipFrame: onSkip("before") });
  const afterFrames = await renderFramesViaWorker({ figPath: resolve(after), onSkipFrame: onSkip("after") });
  const byName = new Map(beforeFrames.map((f) => [f.name, f] as const));
  const tally = await accumulateVerify(afterFrames, byName, outDir);
  if (tally.comparedFrames > 0) {
    const overall = tally.totalPixels === 0 ? 0 : (tally.totalDiffPixels / tally.totalPixels) * 100;
    process.stdout.write(
      `refine-fig verify: ${tally.comparedFrames} frames, total diff ${tally.totalDiffPixels}/${tally.totalPixels} (${overall.toFixed(4)}%)\n`,
    );
  }
}

type VerifyTally = {
  readonly totalDiffPixels: number;
  readonly totalPixels: number;
  readonly comparedFrames: number;
};

async function accumulateVerify(
  afterFrames: readonly WorkerRenderedFrame[],
  byName: ReadonlyMap<string, WorkerRenderedFrame>,
  outDir: string,
): Promise<VerifyTally> {
  const init: VerifyTally = { totalDiffPixels: 0, totalPixels: 0, comparedFrames: 0 };
  return afterFrames.reduce(async (accP, after) => {
    const acc = await accP;
    const before = byName.get(after.name);
    if (!before) {
      process.stdout.write(`  [skip] no matching before frame for "${after.name}"\n`);
      return acc;
    }
    const dir = join(outDir, after.name.replace(/\W+/g, "_") || "frame");
    await ensureDir(dir);
    await writeFile(join(dir, "before.png"), before.png);
    await writeFile(join(dir, "after.png"), after.png);
    const cmp = comparePng(after.png, before.png, { threshold: 0.1 });
    if (cmp.kind === "compared") {
      await writeFile(join(dir, "diff.png"), cmp.diffPng);
      const total = cmp.width * cmp.height;
      process.stdout.write(
        `  ${after.name}: ${cmp.width}×${cmp.height} ${cmp.diffPixels}/${total} px (${cmp.diffPercent.toFixed(3)}%)\n`,
      );
      return {
        totalDiffPixels: acc.totalDiffPixels + cmp.diffPixels,
        totalPixels: acc.totalPixels + total,
        comparedFrames: acc.comparedFrames + 1,
      };
    }
    process.stdout.write(
      `  ${after.name}: dimension mismatch ${cmp.actual.width}×${cmp.actual.height} vs ${cmp.expected.width}×${cmp.expected.height}\n`,
    );
    return acc;
  }, Promise.resolve(init));
}

/** Top-level CLI entry. */
export async function runCli(argv: readonly string[]): Promise<void> {
  const args = parseArgs(argv);
  if (args.command === "inventory") {
    await commandInventory(args);
    return;
  }
  if (args.command === "workbench") {
    await commandWorkbench(args);
    return;
  }
  if (args.command === "scaffold") {
    await commandScaffold(args);
    return;
  }
  if (args.command === "plan") {
    await commandPlan(args);
    return;
  }
  if (args.command === "apply") {
    await commandApply(args);
    return;
  }
  if (args.command === "verify") {
    await commandVerify(args);
    return;
  }
  if (args.command === "diff") {
    await commandDiff(args);
    return;
  }
  throw new Error(`refine-fig: unknown command "${args.command}"`);
}
