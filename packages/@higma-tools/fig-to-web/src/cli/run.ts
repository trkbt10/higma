/**
 * @file CLI runtime — IO orchestration that ties parsing, fig load,
 * emit, bundle, and (optionally) serve together.
 *
 * Kept thin: the heavy lifting is in `emit/`, `tokens/`, and the
 * bundle/serve modules. The runtime's job is to surface errors
 * (missing canvas, missing frame, unwritable output dir, bundle
 * failure) with messages a developer can act on without reading
 * source.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { CliOptions } from "./args";
import { createFigDocumentContext, findCanvas, type FigDocumentContext } from "@higma-document-io/fig/context";
import { emitFromFrames, listFrameTargets, pickFrameByName } from "../emit";
import type { FigNode } from "@higma-document-models/fig/types";
import { bundlePreview } from "./bundle";
import { startPreviewServer } from "./preview-server";

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

function selectFrames(source: FigDocumentContext, options: CliOptions): readonly FigNode[] {
  const canvas = findCanvas(source.document, options.page);
  if (!canvas) {
    throw new Error(`No user-visible page named "${options.page}" found in fig file`);
  }
  const all = listFrameTargets(source.document, canvas);
  if (all.length === 0) {
    throw new Error(`Page "${options.page}" has no frame-like top-level children to emit`);
  }
  if (options.mode === "list") {
    return all;
  }
  if (options.mode !== "single") {
    return all;
  }
  if (!options.frame) {
    throw new Error("internal: mode=single without --frame value");
  }
  return [pickFrameByName(all, options.frame)];
}

/**
 * Drive the full pipeline from CLI options: load the fig file, select
 * frames, emit files, bundle the browser preview, and (when requested)
 * start a static server. The `output` console is dependency-injected
 * so tests can capture stdout/stderr without touching `process.std*`.
 */
export async function runCli(options: CliOptions, output: CliConsole = DEFAULT_CONSOLE): Promise<void> {
  output.info(`Loading ${options.input}`);
  const buffer = await readBuffer(options.input);
  const source = await createFigDocumentContext(buffer);

  const frames = selectFrames(source, options);

  if (options.mode === "list") {
    output.info(`Frames under "${options.page}":`);
    for (const frame of frames) {
      const sizeStr = frame.size ? `${Math.round(frame.size.x)}x${Math.round(frame.size.y)}` : "?x?";
      output.info(`  - ${frame.name ?? "(unnamed)"} [${frame.type.name}] ${sizeStr}`);
    }
    return;
  }

  if (options.serve) {
    // Lazy preview: start immediately and produce each frame's React
    // bundle + authoritative SVG the first time its page is opened, so
    // startup no longer pays the per-frame render/bundle cost up front.
    // The build-to-disk path below is the eager one used by the
    // verifier and any consumer that wants the full tree on disk.
    output.info(`Starting preview server (frames generate on first open) …`);
    const handle = await startPreviewServer({ source, frames, options, output });
    output.info(`Preview running at http://localhost:${handle.port}/`);
    output.info(`Press Ctrl-C to stop.`);
    await new Promise(() => {
      // Block forever — Bun.serve keeps the event loop alive; stop on SIGINT.
    });
    return;
  }

  output.info(`Emitting ${frames.length} frame${frames.length === 1 ? "" : "s"} → ${options.out}`);
  const result = await emitFromFrames(source, frames, {
    debugAttrs: options.debugAttrs,
    exportStyle: options.exportStyle,
    cssMode: options.cssMode,
    cssImport: options.cssImport,
    variantStrategy: options.variantStrategy,
    assetStrategy: options.assetStrategy,
    assetComplexityThreshold: options.assetComplexityThreshold,
  });

  for (const file of result.files) {
    const fullPath = resolve(options.out, file.path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, file.contents, "utf-8");
    output.info(`  wrote ${file.path}`);
  }
  for (const asset of result.assets) {
    const fullPath = resolve(options.out, asset.path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, asset.bytes);
    output.info(`  wrote ${asset.path}`);
  }

  if (options.bundle) {
    output.info(`Bundling preview …`);
    await bundlePreview(options.out);
    output.info(`  wrote main.js`);
  }

  output.info(`Done — ${result.files.length} source file${result.files.length === 1 ? "" : "s"} written.`);
}
