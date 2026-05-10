/**
 * @file Batch Godot render driver. Replaces the per-frame
 * `renderGodotToPng` fork-per-call pattern with a single Godot
 * process that walks N scenes and saves N PNGs.
 *
 * Why batch: each Godot process is ~120 MB resident. The per-frame
 * driver forked one process per render, so a ~150-frame sweep ran
 * 150 forks back-to-back and accumulated GB of resident memory under
 * any concurrency. Spec runners ran them in parallel via vitest's
 * default pool, which could OOM the host machine. The batch path
 * keeps a single Godot process alive across all renders, swapping
 * scenes in and out of one SubViewport — same per-render cost,
 * constant memory, no fork storm.
 *
 * Caller workflow:
 *
 *   const result = await renderGodotBatch([
 *     { sceneText: file1.contents, width: 200, height: 200 },
 *     { sceneText: file2.contents, width: 140, height: 100 },
 *     ...
 *   ]);
 *   // result.pngs[i] is the PNG bytes for entry i.
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  defaultGodotBinary,
  defaultHarnessProjectPath,
} from "./godot-render";

const HARNESS_BATCH_SCRIPT = "render-batch.gd";
const DEFAULT_TIMEOUT_MS = 600_000;

export type GodotBatchEntry = {
  /** Emitted `.tscn` text. */
  readonly sceneText: string;
  /** Optional companion files keyed by `res://`-relative path. */
  readonly companions?: ReadonlyMap<string, string>;
  readonly width: number;
  readonly height: number;
};

export type GodotBatchResult = {
  /** PNG bytes per input entry, same order. */
  readonly pngs: readonly Uint8Array[];
};

export type GodotBatchOptions = {
  readonly godotBinary?: string;
  readonly timeoutMs?: number;
  readonly keepTemp?: boolean;
};

/**
 * Render every entry in one Godot process. Keeps total memory bounded
 * regardless of entry count.
 */
export async function renderGodotBatch(
  entries: readonly GodotBatchEntry[],
  options: GodotBatchOptions = {},
): Promise<GodotBatchResult> {
  if (entries.length === 0) {
    return { pngs: [] };
  }

  const harnessRoot = defaultHarnessProjectPath();
  const projectDir = await mkdtemp(join(tmpdir(), "fig-to-godot-batch-"));
  const projectGodot = await readFile(join(harnessRoot, "project.godot"), "utf8");
  const renderScript = await readFile(join(harnessRoot, HARNESS_BATCH_SCRIPT), "utf8");
  await writeFile(join(projectDir, "project.godot"), projectGodot, "utf8");
  await writeFile(join(projectDir, HARNESS_BATCH_SCRIPT), renderScript, "utf8");

  // Stage every scene + companion into the project root and build the
  // manifest. PNG outputs are written next to the scenes; we read them
  // back after Godot exits.
  type ManifestEntry = {
    readonly scene: string;
    readonly out: string;
    readonly w: number;
    readonly h: number;
  };
  const manifest: ManifestEntry[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!;
    const sceneName = `scene_${String(i).padStart(4, "0")}.tscn`;
    const outName = `frame_${String(i).padStart(4, "0")}.png`;
    await writeFile(join(projectDir, sceneName), entry.sceneText, "utf8");
    if (entry.companions) {
      for (const [relPath, contents] of entry.companions) {
        const target = resolve(projectDir, relPath);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, contents, "utf8");
      }
    }
    manifest.push({ scene: `res://${sceneName}`, out: outName, w: entry.width, h: entry.height });
  }
  await writeFile(join(projectDir, "manifest.json"), JSON.stringify(manifest), "utf8");

  try {
    await runBatchGodot({
      godotBinary: options.godotBinary ?? defaultGodotBinary(),
      projectDir,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    const pngs: Uint8Array[] = [];
    for (const m of manifest) {
      const pngBytes = await readFile(join(projectDir, m.out));
      pngs.push(new Uint8Array(pngBytes.buffer, pngBytes.byteOffset, pngBytes.byteLength));
    }
    return { pngs };
  } finally {
    if (!options.keepTemp) {
      await rm(projectDir, { recursive: true, force: true });
    }
  }
}

/** Path to the bundled batch render script. */
export function defaultBatchScriptName(): string {
  return HARNESS_BATCH_SCRIPT;
}

void fileURLToPath;

type RunBatchOptions = {
  readonly godotBinary: string;
  readonly projectDir: string;
  readonly timeoutMs: number;
};

async function runBatchGodot(options: RunBatchOptions): Promise<void> {
  const args = [
    "--audio-driver",
    "Dummy",
    "--rendering-driver",
    "opengl3",
    "--path",
    options.projectDir,
    "-s",
    HARNESS_BATCH_SCRIPT,
    "--",
    "manifest.json",
    options.projectDir,
  ];
  await new Promise<void>((resolveRun, rejectRun) => {
    const child = spawn(options.godotBinary, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      rejectRun(new Error(`godot batch render timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs);
    child.once("error", (err) => {
      clearTimeout(timer);
      rejectRun(err);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolveRun();
        return;
      }
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      rejectRun(
        new Error(
          `godot batch render exited with code ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      );
    });
  });
}
