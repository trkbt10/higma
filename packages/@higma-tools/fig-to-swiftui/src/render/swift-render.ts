/**
 * @file Drive Apple's `swift` CLI to render a fig-to-swiftui-emitted
 * `.swift` file into a PNG.
 *
 * Pipeline:
 *
 *   1. Read the emitter output (`import SwiftUI` + `struct X: View {…}`
 *      + `#Preview { X() }`).
 *   2. Strip the `#Preview` block — `swift` CLI script-mode does not
 *      expand the macro, so a literal `#Preview { ... }` is a syntax
 *      error.
 *   3. Concatenate Driver.swift + the user source + a one-line
 *      `viewBuilders` dispatch table + a `runRender()` invocation into
 *      one temp file.
 *   4. Invoke `swift TEMP.swift STRUCT_NAME OUT_PATH WIDTH HEIGHT`.
 *   5. Read the PNG bytes back from `OUT_PATH`.
 *
 * `swift` CLI is required (Apple's Swift toolchain — macOS-only).
 * `isSwiftAvailable()` lets callers skip the render gracefully when
 * the toolchain is missing (e.g. CI on Linux runners). We never silently
 * substitute a stub renderer — if Swift is missing the caller gets an
 * explicit "skipped" branch instead of a fake-pass.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DRIVER_FILENAME = "Driver.swift";

/** Result of a successful Swift render. */
export type SwiftRenderResult = {
  readonly png: Uint8Array;
  readonly width: number;
  readonly height: number;
  /** Path of the temp Swift file that was compiled. Useful for debugging. */
  readonly tempSourcePath: string;
};

export type SwiftRenderOptions = {
  /** Emitted Swift source — `import SwiftUI` + `struct <Name>: View { ... }`. */
  readonly source: string;
  /** PascalCase struct name to instantiate (matches `FrameTarget.structName`). */
  readonly structName: string;
  /** Render width in points. */
  readonly width: number;
  /** Render height in points. */
  readonly height: number;
  /**
   * Override the path to `Driver.swift`. Defaults to the file shipped
   * inside this package under `tools/swift-render/Driver.swift`.
   */
  readonly driverPath?: string;
  /** Optional override for the `swift` CLI path. Defaults to `swift` on PATH. */
  readonly swiftBinary?: string;
  /** Per-render timeout in ms. Default 60_000. */
  readonly timeoutMs?: number;
  /**
   * When set, keep the temp directory for inspection (the function
   * returns `tempSourcePath` so the caller can locate it). Defaults
   * to false so successful renders clean up after themselves.
   */
  readonly keepTemp?: boolean;
};

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Run the Swift renderer on `options.source` and return the rendered
 * PNG bytes. Throws if the Swift toolchain is missing, the source
 * fails to compile, or the render exits non-zero.
 */
export async function renderSwiftToPng(options: SwiftRenderOptions): Promise<SwiftRenderResult> {
  const driverPath = options.driverPath ?? defaultDriverPath();
  const driverSource = await readFile(driverPath, "utf8");
  const stripped = stripPreviewMacro(options.source);
  const composed = composeProgram({
    driver: driverSource,
    user: stripped,
    structName: options.structName,
  });

  const tempDir = await mkdtemp(join(tmpdir(), "fig-to-swiftui-render-"));
  const tempSourcePath = join(tempDir, "render.swift");
  const tempOutPath = join(tempDir, "actual.png");
  await writeFile(tempSourcePath, composed, "utf8");

  try {
    await runSwift({
      swiftBinary: options.swiftBinary ?? "swift",
      sourcePath: tempSourcePath,
      structName: options.structName,
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
      tempSourcePath,
    };
  } finally {
    if (!options.keepTemp) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

/**
 * Probe whether a Swift toolchain is callable on PATH (or via the
 * supplied override). Used by specs to gate `describe.runIf(...)`
 * blocks so CI without Swift doesn't fail outright.
 */
export async function isSwiftAvailable(swiftBinary: string = "swift"): Promise<boolean> {
  try {
    await new Promise<void>((resolveProbe, rejectProbe) => {
      const child = spawn(swiftBinary, ["--version"], { stdio: "ignore" });
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
 * Locate `tools/swift-render/Driver.swift` relative to this module.
 * The file is shipped inside the package so consumers don't need to
 * know its on-disk location.
 */
export function defaultDriverPath(): string {
  const here = fileURLToPath(new URL(".", import.meta.url));
  return resolve(here, "..", "..", "tools", "swift-render", DRIVER_FILENAME);
}

/**
 * Strip a top-level `#Preview { ... }` block from emitter output.
 *
 * The emitter writes the macro at the file's tail with brace nesting
 * limited to a single block (`#Preview { Button() }`) — fig-to-swiftui
 * never emits a multi-line `#Preview` body. We match the literal
 * `#Preview` keyword followed by whitespace then `{`, then balance
 * braces forward until the matching `}`. Anything after the macro
 * is preserved verbatim.
 */
export function stripPreviewMacro(source: string): string {
  const start = source.indexOf("#Preview");
  if (start === -1) {
    return source;
  }
  const open = source.indexOf("{", start);
  if (open === -1) {
    return source;
  }
  const end = balanceBraces(source, open);
  if (end === -1) {
    return source;
  }
  // Drop the macro and any single trailing newline so the residue
  // doesn't end with two blank lines.
  const before = source.slice(0, start).replace(/\n+$/u, "\n");
  const after = source.slice(end + 1).replace(/^\n+/u, "");
  return `${before}${after}`;
}

function balanceBraces(source: string, openIndex: number): number {
  const counter = { depth: 0 };
  for (let i = openIndex; i < source.length; i = i + 1) {
    const ch = source[i];
    if (ch === "{") {
      counter.depth = counter.depth + 1;
      continue;
    }
    if (ch === "}") {
      counter.depth = counter.depth - 1;
      if (counter.depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

type ComposeOptions = {
  readonly driver: string;
  readonly user: string;
  readonly structName: string;
};

/**
 * Concatenate driver + user source + a single-entry `viewBuilders`
 * dispatch table + `runRender()`. The result is a self-contained
 * Swift script that `swift FILENAME ARGS...` can run.
 *
 * Dispatch table approach: SwiftUI views are value types, so a
 * `NSClassFromString`-style runtime lookup is not available. Instead
 * we emit a compile-time-known closure keyed by the user's struct
 * name. The single-entry table is the simplest shape that satisfies
 * the driver's lookup.
 */
function composeProgram(options: ComposeOptions): string {
  return [
    options.driver,
    "// ---- generated by fig-to-swiftui ----",
    options.user,
    `let viewBuilders: [String: (CGFloat, CGFloat) -> Data] = [`,
    `  "${options.structName}": { (w: CGFloat, h: CGFloat) -> Data in`,
    `    return MainActor.assumeIsolated { renderViewToPng(${options.structName}(), width: w, height: h) }`,
    `  },`,
    `]`,
    `MainActor.assumeIsolated { runRender() }`,
    "",
  ].join("\n");
}

type RunSwiftOptions = {
  readonly swiftBinary: string;
  readonly sourcePath: string;
  readonly structName: string;
  readonly outPath: string;
  readonly width: number;
  readonly height: number;
  readonly timeoutMs: number;
};

function runSwift(options: RunSwiftOptions): Promise<void> {
  return new Promise<void>((resolveRun, rejectRun) => {
    const child = spawn(
      options.swiftBinary,
      [
        options.sourcePath,
        options.structName,
        options.outPath,
        String(options.width),
        String(options.height),
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      rejectRun(new Error(`swift render timed out after ${options.timeoutMs} ms`));
    }, options.timeoutMs);
    child.once("error", (err) => {
      clearTimeout(timer);
      rejectRun(err);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        resolveRun();
        return;
      }
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      rejectRun(
        new Error(
          `swift render failed (exit=${String(code)} signal=${String(signal)}):\n${stderr || stdout}`,
        ),
      );
    });
  });
}

