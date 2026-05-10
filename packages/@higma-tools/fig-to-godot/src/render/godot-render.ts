/**
 * @file Drive the Godot CLI to render a fig-to-godot-emitted `.tscn`
 * into a PNG.
 *
 * Pipeline:
 *
 *   1. Write the `.tscn` text (and any companion `.tres` Theme) into a
 *      temp directory.
 *   2. Invoke `godot --headless --path <render-harness-project> -s
 *      render.gd -- <abs-tscn-path> <abs-out-png> <width> <height>`.
 *   3. Read the PNG bytes back from the temp file.
 *
 * `godot` (Godot 4.x) is required. `isGodotAvailable()` lets specs
 * skip the render gracefully when the binary is missing (CI without
 * Godot installed) — we never silently substitute a stub renderer.
 *
 * The render harness is a tiny Godot project shipped under
 * `tools/godot-render/{project.godot,render.gd}`. It contains no
 * game code; `render.gd` instantiates the scene, sizes the viewport,
 * waits one frame, and screenshots.
 */
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir, platform } from "node:os";
import { fileURLToPath } from "node:url";

const HARNESS_DIRNAME = "godot-render";
const HARNESS_SCRIPT = "render.gd";
const DEFAULT_TIMEOUT_MS = 60_000;

/** Result of a successful Godot render. */
export type GodotRenderResult = {
  readonly png: Uint8Array;
  readonly width: number;
  readonly height: number;
  /** Path of the temp `.tscn` that was rendered. Useful for debugging. */
  readonly tempScenePath: string;
};

export type GodotRenderOptions = {
  /** Emitted `.tscn` text — `[gd_scene ...]` + nodes + sub-resources. */
  readonly scene: string;
  /**
   * Optional companion files to write next to the scene. Use this for
   * `Themes/<name>.tres` when the scene references it via
   * `[ext_resource path="res://Themes/<name>.tres" ...]`. The key is
   * the path relative to the project root (matches the `res://` path
   * the scene uses); the value is the file contents.
   */
  readonly companions?: ReadonlyMap<string, string>;
  /** Render width in pixels. */
  readonly width: number;
  /** Render height in pixels. */
  readonly height: number;
  /** Override the path to the `godot` CLI. Defaults to platform-aware probe. */
  readonly godotBinary?: string;
  /** Per-render timeout in ms. Default 60_000. */
  readonly timeoutMs?: number;
  /**
   * When set, keep the temp directory for inspection. The function
   * still returns `tempScenePath` so the caller can locate it.
   */
  readonly keepTemp?: boolean;
};

/**
 * Run the Godot renderer on `options.scene` and return the rendered
 * PNG bytes. Throws if Godot is missing, the scene fails to load, or
 * the render exits non-zero.
 */
export async function renderGodotToPng(options: GodotRenderOptions): Promise<GodotRenderResult> {
  const harnessRoot = defaultHarnessProjectPath();
  // Godot's `--path` must point at a directory containing a
  // `project.godot`. We need the .tscn to live *inside* that project
  // so `res://` paths in the scene resolve correctly. Solution: stage
  // the scene + companions inside a temp project layout that mirrors
  // the harness, then point `--path` at the temp dir.
  const tempProjectDir = await mkdtemp(join(tmpdir(), "fig-to-godot-render-"));
  const projectFilePath = join(tempProjectDir, "project.godot");
  const scriptFilePath = join(tempProjectDir, HARNESS_SCRIPT);
  const projectGodot = await readFile(join(harnessRoot, "project.godot"), "utf8");
  const renderScript = await readFile(join(harnessRoot, HARNESS_SCRIPT), "utf8");
  await writeFile(projectFilePath, projectGodot, "utf8");
  await writeFile(scriptFilePath, renderScript, "utf8");

  const tempScenePath = join(tempProjectDir, "scene.tscn");
  await writeFile(tempScenePath, options.scene, "utf8");

  if (options.companions) {
    for (const [relPath, contents] of options.companions) {
      const target = resolve(tempProjectDir, relPath);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, contents, "utf8");
    }
  }

  const tempOutPath = join(tempProjectDir, "actual.png");

  try {
    await runGodot({
      godotBinary: options.godotBinary ?? defaultGodotBinary(),
      projectDir: tempProjectDir,
      scriptName: HARNESS_SCRIPT,
      // Godot's ResourceLoader only accepts `res://` paths; the scene
      // file lives at `<projectDir>/scene.tscn` so its `res://` form is
      // simply `res://scene.tscn`.
      scenePath: "res://scene.tscn",
      outPath: tempOutPath,
      width: options.width,
      height: options.height,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    const png = await readFile(tempOutPath);
    return {
      png: new Uint8Array(png.buffer, png.byteOffset, png.byteLength),
      width: options.width,
      height: options.height,
      tempScenePath,
    };
  } finally {
    if (!options.keepTemp) {
      await rm(tempProjectDir, { recursive: true, force: true });
    }
  }
}

/**
 * Probe whether Godot is callable. Used by specs to gate
 * `it.skipIf(!available)` so CI without Godot doesn't fail outright.
 */
export async function isGodotAvailable(godotBinary: string = defaultGodotBinary()): Promise<boolean> {
  try {
    await new Promise<void>((resolveProbe, rejectProbe) => {
      const child = spawn(godotBinary, ["--version"], { stdio: "ignore" });
      child.once("error", rejectProbe);
      child.once("exit", (code) => (code === 0 ? resolveProbe() : rejectProbe(new Error(`exit ${code}`))));
    });
    return true;
  } catch (_err: unknown) {
    void _err;
    return false;
  }
}

/**
 * Pick a sensible default Godot binary path:
 *
 *   - macOS: `/Applications/Godot.app/Contents/MacOS/Godot` (the
 *     standard install location for the Godot.app bundle).
 *   - Other platforms: bare `godot` on PATH.
 *
 * Override via `GODOT_BINARY` env var or `options.godotBinary`.
 */
export function defaultGodotBinary(): string {
  const fromEnv = process.env.GODOT_BINARY;
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv;
  }
  if (platform() === "darwin") {
    return "/Applications/Godot.app/Contents/MacOS/Godot";
  }
  return "godot";
}

/** Locate `tools/godot-render/` relative to this module. */
export function defaultHarnessProjectPath(): string {
  const here = fileURLToPath(new URL(".", import.meta.url));
  return resolve(here, "..", "..", "tools", HARNESS_DIRNAME);
}

type RunGodotOptions = {
  readonly godotBinary: string;
  readonly projectDir: string;
  readonly scriptName: string;
  readonly scenePath: string;
  readonly outPath: string;
  readonly width: number;
  readonly height: number;
  readonly timeoutMs: number;
};

async function runGodot(options: RunGodotOptions): Promise<void> {
  // **Why not `--headless`?** That flag is shorthand for
  // `--display-driver headless --audio-driver Dummy`, which forces
  // Godot's *dummy* rendering server. The dummy server does not
  // allocate textures, so `viewport.get_texture()` returns null and
  // `image.save_png()` fails. There is no `--display-driver headless`
  // + real-rendering-driver combination in Godot 4.6: headless and
  // `dummy` rendering are the same thing.
  //
  // The workaround is to keep the platform display driver (macOS
  // picks Metal by default; Linux Vulkan; Windows D3D12). That does
  // briefly open a window during the render — annoying for an
  // interactive shell but acceptable for a one-shot CI run since the
  // window closes as soon as `quit(0)` fires. We still pass
  // `--audio-driver Dummy` so the renderer doesn't allocate audio
  // hardware that's irrelevant to image capture.
  const args = [
    "--audio-driver",
    "Dummy",
    "--path",
    options.projectDir,
    "-s",
    options.scriptName,
    "--",
    options.scenePath,
    options.outPath,
    String(options.width),
    String(options.height),
  ];
  await new Promise<void>((resolveRun, rejectRun) => {
    const child = spawn(options.godotBinary, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      rejectRun(new Error(`godot render timed out after ${options.timeoutMs}ms`));
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
          `godot render exited with code ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      );
    });
  });
}
