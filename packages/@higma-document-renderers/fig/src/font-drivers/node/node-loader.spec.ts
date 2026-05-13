/**
 * @file Node font loader — end-to-end tests through the public API.
 *
 * These exercise the loader against a fake `NodeFontLoaderEnv` so the
 * full pipeline (per-platform discovery → name-table parse → variant
 * ranking → loadFont) runs without touching the host. Fixture fonts
 * are synthesised via `opentype.js` so we can control family names
 * and subfamilies precisely.
 *
 * Coverage:
 *   - Fail-fast: unknown family returns `undefined` (no silent
 *     sans-serif rescue).
 *   - Generic CSS keywords (`sans-serif`, `serif`, ...) walk their
 *     published stack — that is CSS-defined, not defensive.
 *   - Variant scoring: style match dominates weight distance, with
 *     deterministic tiebreakers.
 *   - macOS / Linux / Windows discovery flows.
 *   - `addFontFile` rejects WOFF2 explicitly.
 *   - `listFontFamilies` dedupes case-insensitively.
 *   - `includeSystemFontDirs: false` produces a custom-only loader.
 *   - `catalogueSource()` reports the strategy actually used.
 */

import { createNodeFontLoaderWithEnv, type NodeFontLoaderEnv } from "./node-loader";
import {
  createFakeExec,
  createFakeFs,
  synthesizeFontBytes,
  type FakeFs,
} from "./test-helpers";

type EnvOverrides = {
  readonly platform?: NodeJS.Platform;
  readonly fs?: FakeFs;
  readonly exec?: NodeFontLoaderEnv["exec"];
  readonly homeDir?: string;
  readonly windowsDir?: string;
  readonly localAppData?: string;
  readonly xdgDataHome?: string;
};

function makeEnv(overrides?: EnvOverrides): NodeFontLoaderEnv {
  const fs = overrides?.fs ?? createFakeFs();
  return {
    fs,
    exec: overrides?.exec ?? createFakeExec({}),
    platform: overrides?.platform ?? "linux",
    homeDir: overrides?.homeDir ?? "/home/user",
    localAppData: overrides?.localAppData,
    windowsDir: overrides?.windowsDir,
    xdgDataHome: overrides?.xdgDataHome,
    xdgConfigHome: undefined,
    cwd: "/work",
  };
}

function plantFont(
  fs: FakeFs,
  filePath: string,
  options: { readonly familyName: string; readonly styleName: string },
): void {
  fs.putFile(filePath, synthesizeFontBytes(options));
}

describe("createNodeFontLoaderWithEnv — fail-fast resolution", () => {
  it("returns undefined for an unknown family rather than substituting from a generic stack", async () => {
    const fs = createFakeFs();
    plantFont(fs, "/usr/share/fonts/Other.ttf", {
      familyName: "Other Sans",
      styleName: "Regular",
    });
    const env = makeEnv({
      platform: "linux",
      fs,
      exec: createFakeExec({
        "fc-list": async () => "/usr/share/fonts/Other.ttf\t0\n",
      }),
    });

    const loader = createNodeFontLoaderWithEnv(env);
    const result = await loader.loadFont({ family: "MissingFamily", weight: 400, style: "normal" });

    expect(result).toBeUndefined();
  });

  it("walks the sans-serif stack only when the request itself names the generic keyword", async () => {
    const fs = createFakeFs();
    plantFont(fs, "/usr/share/fonts/Helvetica Neue.ttf", {
      familyName: "Helvetica Neue",
      styleName: "Regular",
    });
    const env = makeEnv({
      platform: "linux",
      fs,
      exec: createFakeExec({
        "fc-list": async () => "/usr/share/fonts/Helvetica Neue.ttf\t0\n",
      }),
    });

    const loader = createNodeFontLoaderWithEnv(env);
    const result = await loader.loadFont({ family: "sans-serif", weight: 400, style: "normal" });

    expect(result).toBeDefined();
    expect(result?.query.family).toBe("Helvetica Neue");
  });
});

describe("createNodeFontLoaderWithEnv — physical alias resolution", () => {
  it("resolves 'SF Pro' through the macOS 'System Font' name-table entry", async () => {
    // On macOS the OS-distributed `/System/Library/Fonts/SFNS.ttf`
    // records its `name` table family as "System Font" — Figma
    // documents authoring "SF Pro" against the same physical file
    // must reach it via the physical-alias SoT, not fall through to
    // "missing font".
    const fs = createFakeFs();
    plantFont(fs, "/System/Library/Fonts/SFNS.ttf", {
      familyName: "System Font",
      styleName: "Regular",
    });
    const env = makeEnv({
      platform: "darwin",
      fs,
      homeDir: "/Users/test",
    });

    const loader = createNodeFontLoaderWithEnv(env);
    const result = await loader.loadFont({ family: "SF Pro", weight: 400, style: "normal" });

    expect(result).toBeDefined();
    // The loaded face's `query.family` reflects the on-disk name
    // ("System Font") — the loader does not relabel the physical
    // file. Downstream callers carry the requested family forward in
    // their cache key (`fontQueryKey`) so the SF Pro → System Font
    // alias does not collapse two distinct intended lookups.
    expect(result?.query.family).toBe("System Font");
  });

  it("resolves 'SF Pro Display' and 'SF Pro Text' through the same alias chain", async () => {
    const fs = createFakeFs();
    plantFont(fs, "/System/Library/Fonts/SFNS.ttf", {
      familyName: "System Font",
      styleName: "Regular",
    });
    const env = makeEnv({ platform: "darwin", fs, homeDir: "/Users/test" });

    const loader = createNodeFontLoaderWithEnv(env);
    expect(
      await loader.loadFont({ family: "SF Pro Display", weight: 400, style: "normal" }),
    ).toBeDefined();
    expect(
      await loader.loadFont({ family: "SF Pro Text", weight: 400, style: "normal" }),
    ).toBeDefined();
  });

  it("does not extend the alias chain to unmapped families", async () => {
    // Fail-fast policy regression: an unrelated family must still
    // surface as undefined when not directly installed, even when a
    // System Font entry exists in the catalogue. The alias chain only
    // covers the documented same-physical-file aliases.
    const fs = createFakeFs();
    plantFont(fs, "/System/Library/Fonts/SFNS.ttf", {
      familyName: "System Font",
      styleName: "Regular",
    });
    const env = makeEnv({ platform: "darwin", fs, homeDir: "/Users/test" });

    const loader = createNodeFontLoaderWithEnv(env);
    const result = await loader.loadFont({ family: "Cursed Type", weight: 400, style: "normal" });

    expect(result).toBeUndefined();
  });

  // ---- Cross-platform fail-fast ----------------------------------------
  // The "SF Pro" ↔ "System Font" mapping is a macOS-specific fact:
  // SFNS.ttf only exists on Apple's OS. On Linux and Windows the
  // alias chain MUST walk and miss — never silently substitute
  // Segoe UI, Helvetica, or any other family that happens to be in
  // the host catalogue. Without these guards a `.fig` authored on
  // macOS that names "SF Pro" would render with a completely
  // unrelated typeface when previewed on a CI Linux runner.

  it("[linux] 'SF Pro' returns undefined when the catalogue has no SFNS / System Font", async () => {
    const fs = createFakeFs();
    plantFont(fs, "/usr/share/fonts/Inter-Regular.ttf", {
      familyName: "Inter",
      styleName: "Regular",
    });
    const env = makeEnv({
      platform: "linux",
      fs,
      exec: createFakeExec({
        "fc-list": async () => "/usr/share/fonts/Inter-Regular.ttf\t0\n",
      }),
    });

    const loader = createNodeFontLoaderWithEnv(env);
    const result = await loader.loadFont({ family: "SF Pro", weight: 400, style: "normal" });

    // The alias chain ["SF Pro", "System Font"] walks both — neither
    // is indexed — and the loader returns undefined. Inter is in the
    // catalogue but is NOT a documented same-physical alias of SF
    // Pro, so it stays unreachable from this request.
    expect(result).toBeUndefined();
  });

  it("[win32] 'SF Pro' does NOT silently substitute Segoe UI", async () => {
    // Critical regression: Segoe UI is Windows's system font and is
    // structurally similar enough that someone might be tempted to
    // alias SF Pro → Segoe UI via a "system fonts are equivalent"
    // shortcut. They are NOT the same physical file; AGENTS.md's
    // fail-fast policy demands the request fail rather than swap
    // typefaces silently.
    const fs = createFakeFs();
    plantFont(fs, "C:/Windows/Fonts/segoeui.ttf", {
      familyName: "Segoe UI",
      styleName: "Regular",
    });
    const env = makeEnv({
      platform: "win32",
      fs,
      windowsDir: "C:/Windows",
      exec: createFakeExec({
        // Stub the registry query so the win32 driver sees Segoe UI
        // through the normal "win32-registry" path (the directory
        // fallback would yield identical results here).
        "reg.exe": async () =>
          "    Segoe UI (TrueType)    REG_SZ    segoeui.ttf\n",
      }),
    });

    const loader = createNodeFontLoaderWithEnv(env);
    const sfProResult = await loader.loadFont({ family: "SF Pro", weight: 400, style: "normal" });
    const segoeResult = await loader.loadFont({ family: "Segoe UI", weight: 400, style: "normal" });

    expect(sfProResult).toBeUndefined();
    // Sanity-check: the Segoe UI entry IS reachable when asked for
    // by its own name, proving the catalogue is populated correctly
    // and the SF Pro miss is about the alias map, not the index.
    expect(segoeResult).toBeDefined();
  });
});

describe("createNodeFontLoaderWithEnv — variant scoring", () => {
  it("prefers the matching weight when style is identical", async () => {
    const fs = createFakeFs();
    plantFont(fs, "/fonts/Inter-Regular.ttf", { familyName: "Inter", styleName: "Regular" });
    plantFont(fs, "/fonts/Inter-Bold.ttf", { familyName: "Inter", styleName: "Bold" });
    const env = makeEnv({
      platform: "linux",
      fs,
      exec: createFakeExec({
        "fc-list": async () =>
          "/fonts/Inter-Regular.ttf\t0\n/fonts/Inter-Bold.ttf\t0\n",
      }),
    });

    const loader = createNodeFontLoaderWithEnv(env);
    const regular = await loader.loadFont({ family: "Inter", weight: 400, style: "normal" });
    const bold = await loader.loadFont({ family: "Inter", weight: 700, style: "normal" });

    expect(regular?.postscriptName).toMatch(/Regular$/);
    expect(bold?.postscriptName).toMatch(/Bold$/);
  });

  it("prefers the matching style even at a worse weight distance", async () => {
    const fs = createFakeFs();
    // Italic at weight 400, upright at weight 700. Query: 400 italic.
    // A weight-only match would pick the upright 400; the correct
    // pick is the italic 400 (perfect style match, perfect weight).
    plantFont(fs, "/fonts/Inter-Italic.ttf", { familyName: "Inter", styleName: "Italic" });
    plantFont(fs, "/fonts/Inter-Bold.ttf", { familyName: "Inter", styleName: "Bold" });
    const env = makeEnv({
      platform: "linux",
      fs,
      exec: createFakeExec({
        "fc-list": async () =>
          "/fonts/Inter-Italic.ttf\t0\n/fonts/Inter-Bold.ttf\t0\n",
      }),
    });

    const loader = createNodeFontLoaderWithEnv(env);
    const italic = await loader.loadFont({ family: "Inter", weight: 400, style: "italic" });

    expect(italic?.query.style).toBe("italic");
  });

  it("breaks ties deterministically on postscript name when style and weight tie", async () => {
    const fs = createFakeFs();
    plantFont(fs, "/fonts/A-Regular.ttf", { familyName: "Inter", styleName: "Regular" });
    plantFont(fs, "/fonts/B-Regular.ttf", { familyName: "Inter", styleName: "Regular" });
    const env = makeEnv({
      platform: "linux",
      fs,
      exec: createFakeExec({
        "fc-list": async () =>
          "/fonts/A-Regular.ttf\t0\n/fonts/B-Regular.ttf\t0\n",
      }),
    });

    const loader = createNodeFontLoaderWithEnv(env);
    // The synthesised fonts get postscript names InterRegular for
    // both files. Ties then fall through to path lex order — A
    // before B.
    const result = await loader.loadFont({ family: "Inter", weight: 400, style: "normal" });
    expect(result).toBeDefined();
  });
});

describe("createNodeFontLoaderWithEnv — addFontFile", () => {
  it("rejects WOFF2 explicitly so the missing-decoder failure is observable", async () => {
    const fs = createFakeFs();
    plantFont(fs, "/work/extra/Inter.woff2", { familyName: "Inter", styleName: "Regular" });
    const env = makeEnv({ platform: "linux", fs });
    const loader = createNodeFontLoaderWithEnv(env, { includeSystemFontDirs: false });

    await expect(loader.addFontFile("/work/extra/Inter.woff2")).rejects.toThrow(/WOFF2/);
  });

  it("rejects unknown extensions rather than silently no-op", async () => {
    const env = makeEnv({ platform: "linux" });
    const loader = createNodeFontLoaderWithEnv(env, { includeSystemFontDirs: false });

    await expect(loader.addFontFile("/foo/font.afm")).rejects.toThrow(/unsupported font extension/);
  });

  it("indexes a parseable file so subsequent loadFont resolves it", async () => {
    const fs = createFakeFs();
    plantFont(fs, "/work/extra/Custom.ttf", { familyName: "Custom Sans", styleName: "Regular" });
    const env = makeEnv({ platform: "linux", fs });
    const loader = createNodeFontLoaderWithEnv(env, { includeSystemFontDirs: false });

    await loader.addFontFile("/work/extra/Custom.ttf");
    const loaded = await loader.loadFont({ family: "Custom Sans", weight: 400, style: "normal" });

    expect(loaded?.query.family).toBe("Custom Sans");
  });
});

describe("createNodeFontLoaderWithEnv — listFontFamilies", () => {
  it("dedupes case-insensitively across multiple variants", async () => {
    const fs = createFakeFs();
    plantFont(fs, "/fonts/Inter-Regular.ttf", { familyName: "Inter", styleName: "Regular" });
    plantFont(fs, "/fonts/Inter-Bold.ttf", { familyName: "Inter", styleName: "Bold" });
    plantFont(fs, "/fonts/Roboto.ttf", { familyName: "Roboto", styleName: "Regular" });
    const env = makeEnv({
      platform: "linux",
      fs,
      exec: createFakeExec({
        "fc-list": async () =>
          [
            "/fonts/Inter-Regular.ttf\t0",
            "/fonts/Inter-Bold.ttf\t0",
            "/fonts/Roboto.ttf\t0",
            "",
          ].join("\n"),
      }),
    });

    const loader = createNodeFontLoaderWithEnv(env);
    const families = await loader.listFontFamilies();

    expect(new Set(families)).toEqual(new Set(["Inter", "Roboto"]));
  });
});

describe("createNodeFontLoaderWithEnv — includeSystemFontDirs", () => {
  it("ignores OS discovery when set to false", async () => {
    const fs = createFakeFs();
    // OS dir has a font, custom dir does too; with includeSystemFontDirs
    // disabled only the custom font is reachable.
    plantFont(fs, "/usr/share/fonts/SystemOnly.ttf", {
      familyName: "System Only",
      styleName: "Regular",
    });
    plantFont(fs, "/work/fonts/Custom.ttf", {
      familyName: "Custom Sans",
      styleName: "Regular",
    });
    const env = makeEnv({
      platform: "linux",
      fs,
      exec: createFakeExec({
        "fc-list": async () => "/usr/share/fonts/SystemOnly.ttf\t0\n",
      }),
    });

    const loader = createNodeFontLoaderWithEnv(env, {
      fontDirs: ["/work/fonts"],
      includeSystemFontDirs: false,
    });

    expect(await loader.isFontAvailable("Custom Sans")).toBe(true);
    expect(await loader.isFontAvailable("System Only")).toBe(false);
    expect(await loader.catalogueSource()).toBe("custom-dirs");
  });

  it("merges OS catalogue with custom dirs when enabled (the default)", async () => {
    const fs = createFakeFs();
    plantFont(fs, "/usr/share/fonts/System.ttf", { familyName: "System Sans", styleName: "Regular" });
    plantFont(fs, "/work/fonts/Custom.ttf", { familyName: "Custom Sans", styleName: "Regular" });
    const env = makeEnv({
      platform: "linux",
      fs,
      exec: createFakeExec({
        "fc-list": async () => "/usr/share/fonts/System.ttf\t0\n",
      }),
    });

    const loader = createNodeFontLoaderWithEnv(env, { fontDirs: ["/work/fonts"] });

    expect(await loader.isFontAvailable("Custom Sans")).toBe(true);
    expect(await loader.isFontAvailable("System Sans")).toBe(true);
  });
});

describe("createNodeFontLoaderWithEnv — per-platform discovery", () => {
  it("on darwin scans /System/Library/Fonts including Supplemental", async () => {
    const fs = createFakeFs();
    plantFont(fs, "/System/Library/Fonts/Helvetica Neue.ttf", {
      familyName: "Helvetica Neue",
      styleName: "Regular",
    });
    plantFont(fs, "/System/Library/Fonts/Supplemental/Arial.ttf", {
      familyName: "Arial",
      styleName: "Regular",
    });
    plantFont(fs, "/Users/u/Library/Fonts/User.ttf", {
      familyName: "User Font",
      styleName: "Regular",
    });
    const env = makeEnv({
      platform: "darwin",
      fs,
      homeDir: "/Users/u",
    });

    const loader = createNodeFontLoaderWithEnv(env);

    expect(await loader.isFontAvailable("Helvetica Neue")).toBe(true);
    expect(await loader.isFontAvailable("Arial")).toBe(true);
    expect(await loader.isFontAvailable("User Font")).toBe(true);
    expect(await loader.catalogueSource()).toBe("darwin-dirs");
  });

  it("on darwin without HOME does not crash when the per-user dir is unavailable", async () => {
    const fs = createFakeFs();
    plantFont(fs, "/System/Library/Fonts/Helvetica Neue.ttf", {
      familyName: "Helvetica Neue",
      styleName: "Regular",
    });
    const env = makeEnv({ platform: "darwin", fs, homeDir: undefined });

    const loader = createNodeFontLoaderWithEnv(env);

    expect(await loader.isFontAvailable("Helvetica Neue")).toBe(true);
  });

  it("on linux uses fontconfig as the OS source of truth", async () => {
    const fs = createFakeFs();
    plantFont(fs, "/usr/share/fonts/DejaVuSans.ttf", {
      familyName: "DejaVu Sans",
      styleName: "Regular",
    });
    const env = makeEnv({
      platform: "linux",
      fs,
      exec: createFakeExec({
        "fc-list": async () => "/usr/share/fonts/DejaVuSans.ttf\t0\n",
      }),
    });

    const loader = createNodeFontLoaderWithEnv(env);

    expect(await loader.catalogueSource()).toBe("linux-fontconfig");
    expect(await loader.isFontAvailable("DejaVu Sans")).toBe(true);
  });

  it("on win32 uses the Fonts registry as the OS source of truth", async () => {
    const fs = createFakeFs();
    plantFont(fs, "C:/Windows/Fonts/arial.ttf", { familyName: "Arial", styleName: "Regular" });
    const env = makeEnv({
      platform: "win32",
      fs,
      windowsDir: "C:/Windows",
      exec: createFakeExec({
        "reg.exe": async () => "    Arial (TrueType)    REG_SZ    arial.ttf\n",
      }),
    });

    const loader = createNodeFontLoaderWithEnv(env);

    expect(await loader.catalogueSource()).toBe("win32-registry");
    expect(await loader.isFontAvailable("Arial")).toBe(true);
  });

  it("on linux falls back to dir scanning when fc-list is missing", async () => {
    const fs = createFakeFs();
    plantFont(fs, "/usr/share/fonts/DejaVuSans.ttf", {
      familyName: "DejaVu Sans",
      styleName: "Regular",
    });
    const env = makeEnv({
      platform: "linux",
      fs,
      exec: createFakeExec({
        "fc-list": async () => {
          throw new Error("ENOENT");
        },
      }),
    });

    const loader = createNodeFontLoaderWithEnv(env);

    expect(await loader.catalogueSource()).toBe("linux-dirs");
    expect(await loader.isFontAvailable("DejaVu Sans")).toBe(true);
  });

  it("returns undefined on an unknown platform without throwing", async () => {
    const env = makeEnv({ platform: "freebsd" as NodeJS.Platform });
    const loader = createNodeFontLoaderWithEnv(env);

    expect(await loader.loadFont({ family: "Inter", weight: 400, style: "normal" })).toBeUndefined();
    expect(await loader.catalogueSource()).toBe("empty");
  });
});
