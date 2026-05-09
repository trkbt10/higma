/**
 * @file refine-fig CLI orchestration.
 *
 * Three commands, all reading and writing real files:
 *
 *   refine-fig analyze <input.fig> --out <dir>          → plan.json
 *   refine-fig apply   <input.fig> --plan <plan.json> --out <out.fig>
 *   refine-fig verify  <before.fig> <after.fig> --out <dir>
 *
 * `analyze` always renders for duplicate detection (use
 * `--skip-duplicates` to skip) and writes a human-readable summary
 * alongside the JSON plan.
 *
 * `apply` reads a plan + the original .fig, mutates the loaded file
 * per plan (rename + fill-style bind), saves to disk.
 *
 * `verify` renders both files frame by frame, pixel-diffs them at
 * matching frame names, and writes png triplets to `<dir>/<frame>/`.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { loadRefineSource } from "../refine-source/load";
import { createNodeRenderer } from "../visual";
import type { NodeRenderer } from "../visual";
import { buildPlan, parseRefinePlan } from "../plan";
import type { RefinePlan } from "../plan";
import { applyPlan } from "../apply";
import { saveFigFile } from "@higma-document-io/fig/roundtrip";
import { renderFrames, comparePng } from "../visual";
import { buildWorkbench } from "../workbench/build";

type ParsedArgs = {
  readonly command: "analyze" | "apply" | "verify" | "workbench";
  readonly positional: readonly string[];
  readonly options: ReadonlyMap<string, string>;
  readonly flags: ReadonlySet<string>;
};

function parseArgs(argv: readonly string[]): ParsedArgs {
  const command = argv[0];
  if (command !== "analyze" && command !== "apply" && command !== "verify" && command !== "workbench") {
    throw new Error(`refine-fig: unknown command "${command ?? ""}". Expected analyze | workbench | apply | verify.`);
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

function pickRenderer(
  source: Awaited<ReturnType<typeof loadRefineSource>>,
  skip: boolean,
): NodeRenderer | undefined {
  if (skip) {
    return undefined;
  }
  return createNodeRenderer({ loaded: source.loaded, symbolMap: source.nodesByGuid });
}

async function commandAnalyze(args: ParsedArgs): Promise<void> {
  const input = args.positional[0];
  if (!input) {
    throw new Error("refine-fig analyze: missing input .fig path");
  }
  const outDir = requireOption(args, "out");
  const skipDuplicates = args.flags.has("skip-duplicates");

  const inputPath = resolve(input);
  const bytes = new Uint8Array(await readFile(inputPath));
  const source = await loadRefineSource(bytes);
  const renderer = pickRenderer(source, skipDuplicates);

  const plan = await buildPlan(source, renderer, {
    file: basename(inputPath),
    bytes: bytes.byteLength,
    skipDuplicateDetection: skipDuplicates,
  });

  await ensureDir(outDir);
  const planPath = join(outDir, "plan.json");
  await writeFile(planPath, JSON.stringify(plan, null, 2));
  const summaryPath = join(outDir, "summary.md");
  await writeFile(summaryPath, formatSummary(plan));
  process.stdout.write(`refine-fig analyze: wrote ${planPath}\n`);
  process.stdout.write(`refine-fig analyze: wrote ${summaryPath}\n`);
}

async function commandWorkbench(args: ParsedArgs): Promise<void> {
  const input = args.positional[0];
  if (!input) {
    throw new Error("refine-fig workbench: missing input .fig path");
  }
  const planPath = requireOption(args, "plan");
  const outDir = requireOption(args, "out");
  const inputPath = resolve(input);
  const bytes = new Uint8Array(await readFile(inputPath));
  const planText = await readFile(resolve(planPath), "utf8");
  const plan: RefinePlan = parseRefinePlan(planText);
  const source = await loadRefineSource(bytes);
  await ensureDir(outDir);
  const result = await buildWorkbench(source, plan, {
    outDir,
    figPath: inputPath,
    file: basename(inputPath),
    bytes: bytes.byteLength,
  });
  process.stdout.write(
    `refine-fig workbench: renames=${result.manifest.renames.length} bindings=${result.manifest.bindings.length} clusters=${result.manifest.clusters.length}\n`,
  );
  if (result.skippedRenames > 0 || result.skippedBindings > 0 || result.skippedClusterMembers > 0) {
    process.stdout.write(
      `refine-fig workbench: skipped renames=${result.skippedRenames} bindings=${result.skippedBindings} cluster-members=${result.skippedClusterMembers} (likely missing OS fonts; see summary.md)\n`,
    );
  }
  process.stdout.write(`refine-fig workbench: index at ${join(outDir, "index.json")}\n`);
}

async function commandApply(args: ParsedArgs): Promise<void> {
  const input = args.positional[0];
  if (!input) {
    throw new Error("refine-fig apply: missing input .fig path");
  }
  const planPath = requireOption(args, "plan");
  const outFig = requireOption(args, "out");

  const inputPath = resolve(input);
  const bytes = new Uint8Array(await readFile(inputPath));
  const planText = await readFile(resolve(planPath), "utf8");
  const plan: RefinePlan = parseRefinePlan(planText);

  const source = await loadRefineSource(bytes);
  const result = applyPlan(source.loaded, plan);
  const out = await saveFigFile(source.loaded);

  await ensureDir(dirname(resolve(outFig)));
  await writeFile(resolve(outFig), out);

  process.stdout.write(
    `refine-fig apply: renamed=${result.renamed} bound=${result.bound} skipped-renames=${result.skippedRenames.length} skipped-bindings=${result.skippedBindings.length}\n`,
  );
  process.stdout.write(`refine-fig apply: wrote ${outFig}\n`);
}

async function commandVerify(args: ParsedArgs): Promise<void> {
  const before = args.positional[0];
  const after = args.positional[1];
  if (!before || !after) {
    throw new Error("refine-fig verify: usage: verify <before.fig> <after.fig> --out <dir>");
  }
  const outDir = requireOption(args, "out");
  await ensureDir(outDir);
  const beforeBytes = new Uint8Array(await readFile(resolve(before)));
  const afterBytes = new Uint8Array(await readFile(resolve(after)));
  const onSkip = (label: string) => (name: string, err: unknown): void => {
    process.stdout.write(
      `  [${label}] skipped frame "${name}" — ${err instanceof Error ? err.message : String(err)}\n`,
    );
  };
  const beforeFrames = await renderFrames(beforeBytes, { tolerateRenderErrors: true, onSkipFrame: onSkip("before") });
  const afterFrames = await renderFrames(afterBytes, { tolerateRenderErrors: true, onSkipFrame: onSkip("after") });
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
  afterFrames: readonly { readonly name: string; readonly png: Uint8Array }[],
  byName: ReadonlyMap<string, { readonly name: string; readonly png: Uint8Array }>,
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

function formatSummary(plan: RefinePlan): string {
  const lines: string[] = [];
  lines.push(`# refine-fig — ${plan.source.file}`);
  lines.push("");
  lines.push(`- size: ${plan.source.bytes.toLocaleString()} bytes`);
  lines.push(`- canvases: ${plan.source.canvases.join(", ")}`);
  lines.push(`- top frames: ${plan.source.topFrameCount}`);
  lines.push(`- nodes walked: ${plan.source.nodeCount}`);
  lines.push("");
  lines.push("## Stats");
  lines.push(`- palette entries: ${plan.stats.paletteEntries}`);
  lines.push(`- typography clusters: ${plan.stats.typographyClusters}`);
  lines.push(`- duplicate clusters: ${plan.stats.duplicateClusters}`);
  if (plan.stats.unrenderableSubtrees > 0) {
    lines.push(`- unrenderable subtrees (skipped during duplicate detection): ${plan.stats.unrenderableSubtrees}`);
  }
  lines.push("");
  lines.push("## Renames (proposed)");
  lines.push(`Total: **${plan.renames.length}**`);
  for (const r of plan.renames.slice(0, 30)) {
    lines.push(`- \`${r.oldName}\` → \`${r.newName}\` _(${r.reason})_`);
  }
  if (plan.renames.length > 30) {
    lines.push(`- … and ${plan.renames.length - 30} more`);
  }
  lines.push("");
  lines.push("## Fill-style bindings (apply v1)");
  lines.push(`Total: **${plan.fillStyleBindings.length}**`);
  // Group by proxyName for readability.
  const byProxy = new Map<string, number>();
  for (const b of plan.fillStyleBindings) {
    byProxy.set(b.proxyName, (byProxy.get(b.proxyName) ?? 0) + 1);
  }
  for (const [name, count] of [...byProxy.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${name}: ${count} nodes`);
  }
  lines.push("");
  lines.push("## Fill-style proposals (reported only)");
  lines.push(`Total: **${plan.fillStyleProposals.length}** — these need new style proxies in the design tool.`);
  for (const p of plan.fillStyleProposals) {
    lines.push(`- \`${p.suggestedName}\` (${p.role}) ${p.colorHex} — ${p.bindings.length} usages`);
  }
  lines.push("");
  lines.push("## Text-style proposals (reported only)");
  lines.push(`Total: **${plan.textStyleProposals.length}**`);
  for (const t of plan.textStyleProposals) {
    const d = t.descriptor;
    lines.push(`- \`${t.suggestedName}\` (${t.role}) — ${d.fontFamily} ${d.fontStyle} ${d.fontSize}px (${t.bindings.length} usages)`);
  }
  lines.push("");
  lines.push("## Host fonts required");
  lines.push(
    "The renderer (used by duplicate detection and the verify pass) resolves fonts from the host OS only — no bundled fallbacks. Install every face below before running `verify` for full coverage.",
  );
  const facesNeeded = collectFontFaces(plan.typographyClusters);
  for (const face of facesNeeded) {
    lines.push(`- ${face.family} ${face.style} (weight ${face.weight}) — ${face.uses} text node${face.uses === 1 ? "" : "s"}`);
  }
  lines.push("");
  lines.push("## Component candidates (reported only)");
  lines.push(`Total: **${plan.componentCandidates.length}**`);
  for (const c of plan.componentCandidates) {
    lines.push(
      `- \`${c.suggestedName}\` (${c.sizeClass.width}×${c.sizeClass.height}) — ${c.memberGuids.length} clones`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

type RequiredFace = {
  readonly family: string;
  readonly style: string;
  readonly weight: number;
  readonly uses: number;
};

/**
 * Aggregate the typography clusters from a plan into the unique
 * (family, style, weight) faces the renderer would need from the host
 * OS. Pure derivation — same SoT as `analyseTypography`, no second
 * walk of the document.
 */
function collectFontFaces(
  clusters: ReadonlyArray<{
    readonly fontFamily: string;
    readonly fontStyle: string;
    readonly fontWeight: number;
    readonly usageCount: number;
  }>,
): readonly RequiredFace[] {
  const byFace = new Map<string, RequiredFace & { uses: number }>();
  for (const c of clusters) {
    const key = `${c.fontFamily}|${c.fontStyle}|${c.fontWeight}`;
    const existing = byFace.get(key);
    if (existing) {
      existing.uses = existing.uses + c.usageCount;
      continue;
    }
    byFace.set(key, {
      family: c.fontFamily,
      style: c.fontStyle,
      weight: c.fontWeight,
      uses: c.usageCount,
    });
  }
  return [...byFace.values()].sort((a, b) => b.uses - a.uses);
}

/** Top-level CLI entry. */
export async function runCli(argv: readonly string[]): Promise<void> {
  const args = parseArgs(argv);
  if (args.command === "analyze") {
    await commandAnalyze(args);
    return;
  }
  if (args.command === "workbench") {
    await commandWorkbench(args);
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
  throw new Error(`refine-fig: unknown command "${args.command}"`);
}
