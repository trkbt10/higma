/**
 * @file Discovery surface for the OS font catalogue.
 *
 * Each platform module exposes a `discover()` function that returns the
 * set of font files the host OS itself would consult. The driver then
 * indexes those files; query resolution stays platform-agnostic.
 */

import type * as fsDefault from "node:fs";

/** Subset of `node:fs` the discovery layer needs. */
export type DiscoveryFs = Pick<
  typeof fsDefault,
  "existsSync" | "readdirSync" | "readFileSync" | "lstatSync"
>;

/**
 * One on-disk font file the OS catalogue claims is installed.
 *
 * `faceIndex` is `undefined` for single-face files. When a discovery
 * strategy already knows which face inside a `.ttc` to pick (fontconfig
 * reports it; registry entries don't), it sets the value so the
 * indexer skips re-walking the collection.
 */
export type DiscoveredFontFile = {
  readonly path: string;
  readonly faceIndex?: number;
};

/**
 * Pluggable child-process executor — discovery on Linux invokes
 * `fc-list`, and on Windows it invokes `reg.exe query`. The driver
 * keeps `child_process` behind this seam so tests can drive the
 * external-tool branches deterministically and so call sites without
 * those binaries (containers, CI without fontconfig) fail explicitly
 * rather than silently yielding empty output.
 */
export type DiscoveryExec = {
  /**
   * Run `cmd` with `args`. Resolve to stdout text on exit code 0.
   * Reject on any non-zero exit, missing binary, or signal — discovery
   * branches expect an exception when the OS tool is unavailable so
   * they can fall back to direct directory scanning.
   */
  run(cmd: string, args: readonly string[]): Promise<string>;
};

export type DiscoveryEnv = {
  readonly fs: DiscoveryFs;
  readonly exec: DiscoveryExec;
  readonly homeDir: string | undefined;
  readonly localAppData: string | undefined;
  readonly windowsDir: string | undefined;
  readonly xdgDataHome: string | undefined;
  readonly xdgConfigHome: string | undefined;
};

export type DiscoveryResult = {
  /** Files the OS reports as installed (deduplicated by `path`+`faceIndex`). */
  readonly files: readonly DiscoveredFontFile[];
  /**
   * Source the discovery walked. Useful for tests and diagnostics —
   * makes it observable whether the Linux branch took fontconfig or
   * the directory-scan fallback, etc.
   */
  readonly source: DiscoverySource;
};

export type DiscoverySource =
  | "darwin-dirs"
  | "linux-fontconfig"
  | "linux-dirs"
  | "win32-registry"
  | "win32-dirs"
  | "custom-dirs"
  | "empty";
