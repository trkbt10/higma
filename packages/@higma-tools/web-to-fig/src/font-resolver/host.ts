/**
 * @file Host-platform FontResolver selector — the single source of
 * truth for "which FontResolver implementation does this process
 * use?".
 *
 * Every caller that needs a resolver (CLI bin, fullpage measurement
 * loop, fidelity scripts) goes through `createHostFontResolver`.
 * Letting each caller hand-write its own `process.platform === "darwin"`
 * branch would be a textbook SoT violation: a future platform
 * implementation (linux fontconfig, in-page CSS Font Loading API)
 * would have to be wired into N places, with the inevitable drift
 * where one caller adopts it and another silently keeps falling
 * through to the throw.
 *
 * Lives under `src/font-resolver/` next to the platform
 * implementations so a new platform implementation is added as a
 * sibling file and registered HERE — and only here. The normaliser
 * does not import this file; it depends purely on the abstract
 * `FontResolver` interface.
 */
import type { FontResolver } from "../normalize/font-resolver";
import { createDarwinFontResolver } from "./darwin";

/**
 * Build the FontResolver appropriate for the current OS.
 *
 * Throws when no platform-specific implementation is registered.
 * Adding a new platform means:
 *   1. add the implementation under `src/font-resolver/<platform>.ts`,
 *   2. register a `process.platform === "<platform>"` arm here.
 *
 * That's the entire ceremony — nowhere else in the codebase needs to
 * change.
 */
export function createHostFontResolver(): FontResolver {
  if (process.platform === "darwin") {
    return createDarwinFontResolver();
  }
  throw new Error(
    `createHostFontResolver: no FontResolver implementation registered for platform "${process.platform}". `
      + "Add one under src/font-resolver/<platform>.ts and register it in src/font-resolver/host.ts.",
  );
}
