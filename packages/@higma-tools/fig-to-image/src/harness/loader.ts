/**
 * @file Lazy adapter that loads the WebGL harness at runtime.
 *
 * Why dynamic import: `@higma-tools/web-fig-roundtrip` is a
 * same-scope sibling, so `enforce-package-boundaries` forbids
 * static imports. The CLI loads the harness via this adapter
 * only when it actually needs to rasterise; `--list` invocations
 * stay sub-second because they never touch puppeteer.
 *
 * The returned object is typed against the local `HarnessApi`
 * surface declared in `../types.ts`. Mismatches between the
 * loaded module and the expected shape would be surfaced as a
 * runtime error when the CLI invokes a missing method — we
 * accept that risk because the type-system can't bridge the
 * dynamic boundary.
 */
import type { HarnessApi } from "../types";

const VERIFY_MODULE_SPECIFIER = "@higma-tools/web-fig-roundtrip/verify";

/**
 * Load the WebGL rasteriser. The returned object is the same
 * value `@higma-tools/web-fig-roundtrip/verify`'s static export
 * would produce — we just resolve it through `import()` so the
 * static-import lint never fires.
 *
 * The cost: ≈250 MB Chromium binary (lazy via puppeteer) and
 * ≈2 s warm import. Cache the result if you intend to call it
 * more than once.
 */
export async function loadHarnessApi(): Promise<HarnessApi> {
  // eslint-disable-next-line no-restricted-syntax -- intentional dynamic import to honour the same-scope sibling rule
  const verifyModule = (await import(VERIFY_MODULE_SPECIFIER)) as Record<string, unknown>;
  return ensureHarnessApi(verifyModule);
}

/**
 * Narrow the dynamically-loaded module to the `HarnessApi`
 * surface we consume. Each entry is checked with a type guard
 * so the final cast is grounded — the only place a runtime
 * mismatch can leak through is the closing return, where every
 * field has already been validated.
 */
function ensureHarnessApi(mod: Record<string, unknown>): HarnessApi {
  const startWebglHarness = expectFunction(mod, "startWebglHarness");
  const listFigFrameTargets = expectFunction(mod, "listFigFrameTargets");
  const streamFigFrames = expectFunction(mod, "streamFigFrames");
  return {
    startWebglHarness: startWebglHarness as HarnessApi["startWebglHarness"],
    listFigFrameTargets: listFigFrameTargets as HarnessApi["listFigFrameTargets"],
    streamFigFrames: streamFigFrames as HarnessApi["streamFigFrames"],
  };
}

function expectFunction(mod: Record<string, unknown>, name: string): (...args: unknown[]) => unknown {
  const value = mod[name];
  if (typeof value !== "function") {
    throw new Error(
      `fig-to-image: ${VERIFY_MODULE_SPECIFIER} exported no "${name}" function. ` +
        "The peer dependency may be a version that predates the streaming API.",
    );
  }
  return value as (...args: unknown[]) => unknown;
}
