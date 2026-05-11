/**
 * @file CLI runtime — IO orchestration for fig-to-swiftui.
 *
 * Kept thin: load the .fig file, select target frames, drive the
 * emitter, write the resulting Swift source to disk. All real logic
 * lives in `emit/`, `style/`, `layout/`, `swift-tree/` modules.
 *
 * Optional rasteriser injection: the CLI binary in `bin.ts`
 * supplies a closure that can render arbitrary fig nodes to PNGs
 * (the closure wraps the WebGL harness from
 * `@higma-tools/web-fig-roundtrip`). When provided AND
 * `--rasterize-threshold` is set, nodes whose complexity exceeds
 * the threshold get rasterised at emit time and replaced with
 * `Image("<slug>", bundle: .module)` SwiftUI leaves — sidestepping
 * SwiftUI's super-linear `body` type-check on path-heavy subtrees.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { findCanvas, type FigSymbolContext } from "@higma-document-io/fig/context";
import type { FigNode } from "@higma-document-models/fig/types";
import type { CliOptions } from "./args";
import { loadFigSource } from "../fig-source/load";
import { emitFromFrames, listFrameTargets, pickFrameByName } from "../emit";
import { planRasterization, type RasterizationEntry } from "../emit/rasterize";
import { imageSlug } from "../style/image";

/**
 * Render a single fig node to a PNG. The CLI binary supplies an
 * implementation that drives the WebGL harness; tests inject a
 * stub that returns a synthetic PNG without spinning up
 * puppeteer.
 */
export type Rasterizer = (
  figBytes: Uint8Array,
  targets: readonly RasterizationEntry[],
) => Promise<readonly { readonly key: string; readonly png: Uint8Array }[]>;

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

type RasterizationStepInputs = {
  readonly rasterizer: Rasterizer | undefined;
  readonly options: CliOptions;
  readonly frames: readonly FigNode[];
  readonly source: FigSymbolContext;
  readonly buffer: Uint8Array;
  readonly output: CliConsole;
};

/**
 * Plan + execute the rasterisation pass. Returns `undefined` when
 * either the user disabled rasterisation, no nodes crossed the
 * complexity threshold, or no rasteriser was injected. Splits out
 * of `runCli` so the data flow is a chain of `const`s rather than
 * a re-assigned local — the project's lint policy bans `let`.
 */
async function runRasterizationStep(
  inputs: RasterizationStepInputs,
): Promise<ReadonlyMap<string, string> | undefined> {
  const { rasterizer, options, frames, source, buffer, output } = inputs;
  if (!rasterizer || options.rasterizeThreshold <= 0) {
    return undefined;
  }
  const plan = planRasterization(frames, {
    threshold: options.rasterizeThreshold,
    blobs: source.blobs,
  });
  if (plan.length === 0) {
    return undefined;
  }
  output.info(
    `Rasterising ${plan.length} complex subtree${plan.length === 1 ? "" : "s"} (threshold ${options.rasterizeThreshold})`,
  );
  const renders = await rasterizer(buffer, plan);
  const lookup = new Map<string, RasterizationEntry>();
  for (const entry of plan) {
    lookup.set(entry.key, entry);
  }
  const map = new Map<string, string>();
  for (const r of renders) {
    const entry = lookup.get(r.key);
    if (!entry) {
      continue;
    }
    const fullPath = resolve(options.out, "Resources", `${entry.resourceSlug}.png`);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, r.png);
    output.info(`  wrote Resources/${entry.resourceSlug}.png`);
    map.set(entry.key, entry.resourceSlug);
  }
  return map;
}

function selectFrames(source: FigSymbolContext, options: CliOptions): readonly FigNode[] {
  const canvas = findCanvas(source, options.page);
  if (!canvas) {
    throw new Error(`No user-visible page named "${options.page}" found in fig file`);
  }
  const all = listFrameTargets(canvas, { includeSymbols: options.includeSymbols });
  if (all.length === 0) {
    throw new Error(`Page "${options.page}" has no frame-like top-level children to emit`);
  }
  if (options.mode === "list") {
    return all;
  }
  if (options.mode === "single") {
    if (!options.frame) {
      throw new Error("internal: mode=single without --frame value");
    }
    return [pickFrameByName(all, options.frame)];
  }
  return all;
}

/**
 * Drive the full pipeline from CLI options: load the fig file, select
 * frames, emit Swift files, and write them to disk. The `output`
 * console is dependency-injected so tests can capture stdout/stderr
 * without touching `process.std*`.
 *
 * `rasterizer` is optional. When supplied alongside a positive
 * `--rasterize-threshold`, nodes that exceed the threshold are
 * pre-rasterised to PNG and emitted as `Image(...)` references.
 * Without it the emit produces only SwiftUI views (the original
 * v0 behaviour).
 */
export async function runCli(
  options: CliOptions,
  output: CliConsole = DEFAULT_CONSOLE,
  rasterizer?: Rasterizer,
): Promise<void> {
  output.info(`Loading ${options.input}`);
  const buffer = await readBuffer(options.input);
  const source = await loadFigSource(buffer);

  const frames = selectFrames(source, options);

  if (options.mode === "list") {
    output.info(`Frames under "${options.page}":`);
    for (const frame of frames) {
      const sizeStr = frame.size ? `${Math.round(frame.size.x)}x${Math.round(frame.size.y)}` : "?x?";
      output.info(`  - ${frame.name ?? "(unnamed)"} [${frame.type.name}] ${sizeStr}`);
    }
    return;
  }

  // Step 1: identify subtrees that need rasterisation.
  const rasterizedSubtrees = await runRasterizationStep({
    rasterizer,
    options,
    frames,
    source,
    buffer,
    output,
  });

  // Step 1.5: write IMAGE-paint bytes to Resources/.  The
  // emitter no longer inlines image bytes as base64; it emits
  // `Image("<slug>", bundle: .module)` references instead, and
  // expects the actual PNG/JPEG bytes to live at
  // `<out>/Resources/<slug>.png`.  Walking `source.images` here
  // is independent of the rasterisation step — every IMAGE paint
  // referenced anywhere in the document gets one resource file,
  // even if it appears under a node we did not rasterise.
  if (source.images && source.images.size > 0) {
    output.info(`Writing ${source.images.size} image resource${source.images.size === 1 ? "" : "s"}`);
    for (const [ref, image] of source.images) {
      const slug = imageSlug(ref);
      // Image extension follows the original mime type when
      // possible.  PNG is the safest default — every macOS / iOS
      // ImageIO build can decode it, and SwiftUI's bundle Image
      // initialiser doesn't care about the extension as long as
      // the resource bundle declares the file as a resource.
      const ext = image.mimeType === "image/jpeg" ? "jpg" : "png";
      const fullPath = resolve(options.out, "Resources", `${slug}.${ext}`);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, image.data);
    }
  }

  // Step 2: emit Swift source. The walker substitutes
  // `Image("<slug>", bundle: .module)` for any node listed in
  // `rasterizedSubtrees`.
  output.info(`Emitting ${frames.length} frame${frames.length === 1 ? "" : "s"} → ${options.out}`);
  const result = emitFromFrames(frames, {
    blobs: source.blobs,
    images: source.images,
    symbolMap: source.symbolMap,
    rasterizedSubtrees,
  });

  for (const file of result.files) {
    const fullPath = resolve(options.out, file.path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, file.contents, "utf-8");
    output.info(`  wrote ${file.path}`);
  }

  output.info(
    `Done — ${result.files.length} Swift file${result.files.length === 1 ? "" : "s"} written.`,
  );
}
