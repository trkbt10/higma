/**
 * @file CLI runtime — IO orchestration for fig-to-godot.
 *
 * Kept thin: load the .fig file, select target frames, drive the
 * emitter, write the resulting `.tscn` files to disk. All real logic
 * lives in `emit/`, `style/`, `layout/`, `godot-tree/` modules.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { findCanvas, type FigSymbolContext } from "@higma-document-io/fig/context";
import type { FigNode } from "@higma-document-models/fig/types";
import type { CliOptions } from "./args";
import { loadFigSource } from "../fig-source/load";
import { emitFromFrames, listFrameTargets, pickFrameByName } from "../emit";

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

function selectFrames(source: FigSymbolContext, options: CliOptions): readonly FigNode[] {
  const canvas = findCanvas(source, options.page);
  if (!canvas) {
    throw new Error(`No user-visible page named "${options.page}" found in fig file`);
  }
  const all = listFrameTargets(canvas);
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
 * frames, emit `.tscn` files, and write them to disk. The `output`
 * console is dependency-injected so tests can capture stdout/stderr
 * without touching `process.std*`.
 */
export async function runCli(options: CliOptions, output: CliConsole = DEFAULT_CONSOLE): Promise<void> {
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

  output.info(`Emitting ${frames.length} frame${frames.length === 1 ? "" : "s"} → ${options.out}`);
  if (options.sharedTheme) {
    output.info(`Shared Theme extraction enabled — Themes/${options.themeName}.tres will hold deduped StyleBoxes.`);
  }
  const result = emitFromFrames(frames, {
    sharedTheme: options.sharedTheme,
    themeName: options.themeName,
    emit: { symbolMap: source.symbolMap, blobs: source.blobs },
  });

  for (const file of result.files) {
    const fullPath = resolve(options.out, file.path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, file.contents, "utf-8");
    output.info(`  wrote ${file.path}`);
  }

  output.info(
    `Done — ${result.files.length} Godot scene${result.files.length === 1 ? "" : "s"} written.`,
  );
}
