/**
 * @file Anchor — physical-alias SoT vs the real macOS name table.
 *
 * The `physical-aliases` SoT in `@higma-document-models/fig/font`
 * claims that on macOS, `/System/Library/Fonts/SFNS.ttf` exposes its
 * `name` table family as "System Font" (and not "SF Pro" or any
 * variant). This spec parses the file off-disk with opentype.js and
 * asserts the claim against reality. If Apple ever renames the
 * embedded family table — or if the install layout changes — this
 * test fires before any downstream rendering test, so the SoT can be
 * updated in lock-step instead of silently drifting.
 *
 * The test is macOS-only and self-skips on every other platform. It
 * is also tolerant of the file being absent (sandboxed CI runners
 * with `/System/Library` redacted) so a missing file does not produce
 * a noisy failure — only a stale family name does.
 *
 * Browser-side note: there is no equivalent for `queryLocalFonts`
 * without a real browser. The same `name` table value is what
 * Chromium's macOS font enumeration surfaces via
 * `CTFontManagerCopyAvailableFontFamilyNames` →
 * `kCTFontFamilyNameAttribute`. The Node-side check is the strongest
 * deterministic anchor available at unit-test time.
 */

import * as fs from "node:fs";
import { parse as parseFont } from "opentype.js";
import { getPhysicalFamilyAliases, physicalFamilyAliasesFor } from "@higma-document-models/fig/font";

const SFNS_PATH = "/System/Library/Fonts/SFNS.ttf";
const SFNS_ROUNDED_PATH = "/System/Library/Fonts/SFNSRounded.ttf";

function readFamilyName(fontPath: string): string | undefined {
  if (!fs.existsSync(fontPath)) {
    return undefined;
  }
  const buffer = fs.readFileSync(fontPath);
  // `Buffer` is a slab-backed view; copy the exact byte range so
  // opentype.js doesn't read into neighbouring buffers. See the
  // matching guard in `node-loader.ts:readFontFileBytes`.
  const ab = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(ab).set(buffer);
  const font = parseFont(ab);
  const names = font.names as { fontFamily?: { en?: string } } | undefined;
  return names?.fontFamily?.en;
}

const onDarwin = process.platform === "darwin";
const describeOnDarwin = onDarwin ? describe : describe.skip;

describeOnDarwin("physical-aliases SoT — macOS name-table reality", () => {
  it("SFNS.ttf records its name.fontFamily.en as 'System Font' (the alias chain target)", () => {
    const family = readFamilyName(SFNS_PATH);
    if (family === undefined) {
      // Sandboxed CI without /System/Library access — the test
      // is informational only in that environment. Inspect the
      // existence guard and skip the assertion rather than fail
      // for environmental reasons.
      return;
    }

    // The SoT in `physical-aliases.ts` routes "SF Pro" through
    // "System Font" precisely because this is the name SFNS.ttf
    // records. If Apple renames the table entry in a future macOS
    // release this assertion fires and the SoT must be updated
    // before any text-rendering regression escapes review.
    expect(family).toBe("System Font");
  });

  it("the alias chain for 'SF Pro' ends at the name SFNS.ttf actually carries", () => {
    const family = readFamilyName(SFNS_PATH);
    if (family === undefined) {
      return;
    }

    const chain = getPhysicalFamilyAliases("SF Pro", "darwin");
    // Last entry is the most-general alias — the catalogue label
    // every macOS install carries. It MUST match the on-disk
    // name table; otherwise the chain walks off the end of any
    // real `queryLocalFonts` / `discoverDarwin` index.
    expect(chain[chain.length - 1]).toBe(family);
  });

  it("SFNSRounded.ttf records '.SF NS Rounded' and is NOT mapped through 'System Font' on darwin", () => {
    const family = readFamilyName(SFNS_ROUNDED_PATH);
    if (family === undefined) {
      return;
    }

    // Rounded is its own physical file — the SoT must NOT silently
    // substitute SFNS.ttf for it. Verify both that the on-disk
    // name confirms the file's separate identity AND that the SoT
    // refuses to alias "SF Pro Rounded" through "System Font".
    expect(family).toBe(".SF NS Rounded");

    const roundedChain = getPhysicalFamilyAliases("SF Pro Rounded", "darwin");
    expect(roundedChain).not.toContain("System Font");
  });

  it("the darwin alias table does not register any dot-prefixed name as a SF Pro alias", () => {
    // Dot-prefixed families on macOS mark fonts as private/system —
    // Chromium's `queryLocalFonts` filters them out of the
    // enumeration. Registering one as a SF Pro alias would put the
    // chain into a state where the loader never reaches the alias
    // on the browser. The SoT only carries aliases that are
    // catalogue-visible on the browser side.
    for (const chain of physicalFamilyAliasesFor("darwin").values()) {
      for (const entry of chain) {
        expect(entry.startsWith(".")).toBe(false);
      }
    }
  });
});
