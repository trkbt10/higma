/**
 * @file CLI runtime — IO orchestration for fig-to-image.
 *
 * Sequence:
 *
 *   1. Load the .fig file as a `FigDocumentContext`.
 *   2. Dynamic-import the rasterisation harness.
 *   3. List candidate targets without starting puppeteer.
 *   4. Compute each target's source-subtree fingerprint and
 *      compare it against the on-disk PNG's embedded fingerprint.
 *   5. If every target is a cache hit, exit without booting the
 *      harness.
 *   6. Otherwise start the harness once, stream every changed
 *      target through `streamFigFrames`, tag the rendered PNG
 *      with the fresh fingerprint, write to disk.
 *
 * The CLI never statically imports the harness (it's a same-
 * scope sibling — boundary lint forbids that). Every harness
 * touch flows through `harness/loader.ts`.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createFigDocumentContext } from "@higma-document-io/fig/context";
import type { CliOptions } from "./args";
import { loadHarnessApi } from "../harness/loader";
import { FINGERPRINT_PNG_KEY, planTargets, type RenderPlanEntry } from "../plan/cache";
import { setTextMetadata } from "../png-meta";
import type { FigFrameTarget, HarnessApi } from "../types";

export type CliConsole = {
  readonly info: (message: string) => void;
  readonly error: (message: string) => void;
};

const DEFAULT_CONSOLE: CliConsole = {
  info: (message: string) => process.stdout.write(`${message}\n`),
  error: (message: string) => process.stderr.write(`${message}\n`),
};

async function readBuffer(path: string): Promise<Uint8Array> {
  const buffer = await readFile(resolve(path));
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

async function readFileIfExists(path: string): Promise<Uint8Array | undefined> {
  const buffer = await readFile(path).catch(() => undefined);
  if (!buffer) {
    return undefined;
  }
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

async function emitList(
  harness: HarnessApi,
  figBytes: Uint8Array,
  options: CliOptions,
  output: CliConsole,
): Promise<void> {
  const candidates = await harness.listFigFrameTargets(figBytes, {
    pageName: options.page,
    includeSymbols: options.includeSymbols,
  });
  if (candidates.length === 0) {
    if (options.page !== undefined) {
      output.info(`No frames found on page "${options.page}"`);
      return;
    }
    output.info("No frames found in fig file");
    return;
  }
  if (options.page !== undefined) {
    output.info(`Frames under "${options.page}":`);
  } else {
    output.info("Frames (all pages):");
  }
  for (const c of candidates) {
    const pageTag = options.page === undefined ? `[${c.page}] ` : "";
    output.info(`  - ${pageTag}${c.frame} [${c.type}] ${c.width}x${c.height}`);
  }
}

function frameNamesFromOptions(options: CliOptions): readonly string[] | undefined {
  if (options.mode === "frames") {
    return options.frames;
  }
  return undefined;
}

function pluralS(count: number): string {
  if (count === 1) {
    return "";
  }
  return "s";
}

/**
 * Build the "no matching frames" CLI error message. Extracted so
 * `runCli` doesn't need a multi-line ternary inside its body.
 */
function noMatchMessage(frameNames: readonly string[] | undefined): string {
  if (!frameNames) {
    return "No top-level frames found in the fig file";
  }
  return `No matching frames found (asked: ${frameNames.join(", ")})`;
}

async function collectPlans(
  harness: HarnessApi,
  figBytes: Uint8Array,
  options: CliOptions,
): Promise<{
  readonly plans: readonly RenderPlanEntry[];
  readonly frameNames: readonly string[] | undefined;
}> {
  const frameNames = frameNamesFromOptions(options);
  const targets = await harness.listFigFrameTargets(figBytes, {
    frameNames,
    pageName: options.page,
    includeSymbols: options.includeSymbols,
  });
  if (targets.length === 0) {
    return { plans: [], frameNames };
  }
  const context = await createFigDocumentContext(figBytes);
  const plans = await planTargets(targets, {
    outDir: options.out,
    filename: options.filename,
    scale: options.scale,
    force: options.force,
    symbolResolver: context.symbolResolver,
    childrenOf: context.document.childrenOf,
    background: options.background,
    readFile: readFileIfExists,
    joinPath: (dir: string, file: string) => resolve(dir, file),
  });
  return { plans, frameNames };
}

async function streamAndWrite(
  harness: HarnessApi,
  figBytes: Uint8Array,
  options: CliOptions,
  renderPlans: readonly RenderPlanEntry[],
  output: CliConsole,
): Promise<void> {
  const targetsForStream = renderPlans.map((p) => p.target);
  const planByTarget = new Map<FigFrameTarget, RenderPlanEntry>();
  for (const p of renderPlans) {
    planByTarget.set(p.target, p);
  }
  const session = await harness.startWebglHarness();
  try {
    const stream = harness.streamFigFrames(session, figBytes, targetsForStream, {
      pixelRatio: options.scale,
      backgroundColor: options.background,
    });
    for await (const rendered of stream) {
      const plan = planByTarget.get(rendered.target);
      if (!plan) {
        throw new Error(
          `fig-to-image: stream yielded a target ("${rendered.target.frame}") ` +
            "that was not in the render plan",
        );
      }
      const tagged = setTextMetadata(rendered.png, FINGERPRINT_PNG_KEY, plan.fingerprint);
      await mkdir(dirname(plan.outPath), { recursive: true });
      await writeFile(plan.outPath, tagged);
      output.info(`  wrote ${plan.filename} (${rendered.width}x${rendered.height})`);
    }
  } finally {
    await session.stop();
  }
}

/**
 * Drive the full pipeline from CLI options: load the .fig file,
 * resolve the harness, enumerate targets, fingerprint-skip
 * cached PNGs, stream the rest through the harness, embed the
 * fingerprint into each rendered PNG, write to disk.
 *
 * `output` is dependency-injected so tests can capture
 * stdout/stderr without touching `process.std*`.
 */
export async function runCli(options: CliOptions, output: CliConsole = DEFAULT_CONSOLE): Promise<void> {
  output.info(`Loading ${options.input}`);
  const figBytes = await readBuffer(options.input);
  const harness = await loadHarnessApi();

  if (options.mode === "list") {
    await emitList(harness, figBytes, options, output);
    return;
  }

  const { plans, frameNames } = await collectPlans(harness, figBytes, options);
  if (plans.length === 0) {
    output.error(noMatchMessage(frameNames));
    throw new Error("fig-to-image: no frames matched");
  }

  const renderPlans = plans.filter((p) => !p.skip);
  for (const plan of plans) {
    if (plan.skip) {
      output.info(`  skip ${plan.filename} (fingerprint matches)`);
    }
  }
  if (renderPlans.length === 0) {
    output.info(`Done — ${plans.length} target${pluralS(plans.length)}, all cached.`);
    return;
  }

  output.info(
    `Rasterising ${renderPlans.length}/${plans.length} target${pluralS(plans.length)} (scale=${options.scale}x)`,
  );
  await streamAndWrite(harness, figBytes, options, renderPlans, output);
  const cached = plans.length - renderPlans.length;
  output.info(`Done — ${renderPlans.length} written, ${cached} cached.`);
}
