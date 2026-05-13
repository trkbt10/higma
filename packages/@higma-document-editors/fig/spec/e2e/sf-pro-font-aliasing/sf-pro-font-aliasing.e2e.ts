/**
 * @file SF Pro physical-alias regression — real Chromium across
 * three simulated host platforms.
 *
 * Locks the *environment-specific* unit of font resolution in real
 * Chromium:
 *
 *   - [darwin]    `window.queryLocalFonts` returns SFNS.ttf under
 *                 family "System Font" (the on-disk name-table
 *                 reality, verified separately by
 *                 `darwin-name-table-reality.spec.ts`). The
 *                 production `createBrowserFontLoader` walks the
 *                 platform-keyed alias chain
 *                 `["SF Pro", "System Font"]` and the editor
 *                 reaches text-edit without throwing.
 *
 *   - [linux]     The same catalogue mock is exposed under a Linux
 *                 userAgent. The alias chain on linux is empty;
 *                 even though "System Font" exists in the
 *                 catalogue, the loader MUST NOT route SF Pro
 *                 through it. The WebGL renderer then surfaces
 *                 `"WebGL text renderer requires glyph contours
 *                 for text node …"` because no font ever loads —
 *                 the explicit signal we assert against.
 *
 *   - [win32]     Same shape as linux; an additional "Segoe UI"
 *                 face is added to prove the loader doesn't pick
 *                 a similar-looking system font either.
 *
 * The negative tests deliberately let the editor crash; we assert
 * on the captured `pageerror` instead of `waitForWebGLEditor`,
 * because a successful boot on non-darwin would be the regression
 * we're locking against.
 *
 * `addInitScript` runs before any page script, so both the
 * userAgent override (which `detectBrowserFontPlatform` reads at
 * loader construction) and the queryLocalFonts mock are in place
 * before `createBrowserFontLoader()` is first invoked.
 */

import { expect, test, type Page } from "@playwright/test";

const SF_PRO_NODE = { pageX: 50, pageY: 420, width: 240, height: 30 };

// =============================================================================
// Synthetic font fixtures (base64-inlined to avoid a side fixture file)
// =============================================================================

// `synthesizeFontBytes({familyName: "System Font", styleName: "Regular"})`
const SYSTEM_FONT_BASE64 =
  "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";

// `synthesizeFontBytes({familyName: "Inter", styleName: "Regular"})`
const INTER_BASE64 =
  "T1RUTwAKAIAAAwAgQ0ZGICxTSekAAATMAAAAl09TLzJo7WMMAAABEAAAAGBjbWFwAHQAPAAABHgAAAA0aGVhZCyVklIAAACsAAAANmhoZWEDIgGUAAAA5AAAACRobXR4BdwAAAAABWQAAAAMbHRhZ2V+AAQAAAVwAAAAEm1heHAAA1AAAAABCAAAAAZuYW1l1IXOdgAAAXAAAAMGcG9zdAADAAAAAASsAAAAIAABAAAAAQAAb8GsT18PPPUAAwPoAAAAAOYpp40AAAAA5imnjQAAAAABLAJYAAAAAwACAAAAAAAAAAEAAAMg/zgAAAJYAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAADAABQAAADAAAAAwGpAfQABQAAAooCuwAAAIwCigK7AAAB3wAxAQIAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAWFhYWABAACAAQQMg/zgAAAJYAAAAAAABAAAAAAGQAlgAIAAgAAAAAAAzAmoAAAAEAAAAAAACACIAAAAEAAAAAQAKAAAAAAAEAAAAAgAOAAoAAAAEAAAAAwAgAEgAAAAEAAAABAAaABgAAAAEAAAABQAWADIAAAAEAAAABgAYAAAAAAAEAAAABwACACIAAAAEAAAACAACACIAAAAEAAAACQACACIAAAAEAAAACgACACIAAAAEAAAACwACACIAAAAEAAAADAACACIAAAAEAAAADQACACIAAAAEAAAADgACACIAAAAEAAAAEAAKAAAAAAAEAAAAEQAOAAoAAQAAAAAAAAABACMAAQAAAAAAAQAFAGgAAQAAAAAAAgAHAG0AAQAAAAAAAwAQAIwAAQAAAAAABAANAHQAAQAAAAAABQALAIEAAQAAAAAABgAMAGgAAQAAAAAABwABACMAAQAAAAAACAABACMAAQAAAAAACQABACMAAQAAAAAACgABACMAAQAAAAAACwABACMAAQAAAAAADAABACMAAQAAAAAADQABACMAAQAAAAAADgABACMAAQAAAAAAEAAFAGgAAQAAAAAAEQAHAG0AAwABBAkAAAACACIAAwABBAkAAQAKAAAAAwABBAkAAgAOAAoAAwABBAkAAwAgAEgAAwABBAkABAAaABgAAwABBAkABQAWADIAAwABBAkABgAYAAAAAwABBAkABwACACIAAwABBAkACAACACIAAwABBAkACQACACIAAwABBAkACgACACIAAwABBAkACwACACIAAwABBAkADAACACIAAwABBAkADQACACIAAwABBAkADgACACIAAwABBAkAEAAKAAAAAwABBAkAEQAOAAoASQBuAHQAZQByAFIAZQBnAHUAbABhAHIASQBuAHQAZQByACAAUgBlAGcAdQBsAGEAcgBWAGUAcgBzAGkAbwBuACAAMAAuADEAIAA6ACAASQBuAHQAZQByACAAUgBlAGcAdQBsAGEAcgBJbnRlclJlZ3VsYXJJbnRlciBSZWd1bGFyVmVyc2lvbiAwLjEgOiBJbnRlciBSZWd1bGFyAAAAAAABAAMAAQAAAAwABAAoAAAABgAEAAEAAgAgAEH//wAAACAAQf///+H/wQABAAAAAAAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAQBAAEBAQ1JbnRlclJlZ3VsYXIAAQEBJ/gbAPgcAvgdA/geBIuL+bT47AUdAAAAdg8dAAAAexGLHQAAAJcSAAYBAQwZHiUqK1ZlcnNpb24gMC4xSW50ZXIgUmVndWxhckludGVyUmVndWxhcnNwYWNlQQAAAAGLAYwAAwEBBAcW+R4O944O+OyLixX3wIsF+yr47AUOAooAAAD6AAACWAAAAAAAAQAAAAAAAAABABAAAmVuAAA=";

// `synthesizeFontBytes({familyName: "Segoe UI", styleName: "Regular"})`
// used by the [win32] test to demonstrate the loader does NOT pick a
// similar-looking system font when the requested family is "SF Pro".
const SEGOE_UI_BASE64 =
  "T1RUTwAKAIAAAwAgQ0ZGIN/v6BUAAATMAAAApk9TLzJo7WMMAAABEAAAAGBjbWFwAHQAPAAABHgAAAA0aGVhZCyVizgAAACsAAAANmhoZWEDIgGUAAAA5AAAACRobXR4BdwAAAAABXQAAAAMbHRhZ2V+AAQAAAWAAAAAEm1heHAAA1AAAAABCAAAAAZuYW1lQt7K9wAAAXAAAAMGcG9zdAADAAAAAASsAAAAIAABAAAAAQAAVu44J18PPPUAAwPoAAAAAOYpqAUAAAAA5imoBQAAAAABLAJYAAAAAwACAAAAAAAAAAEAAAMg/zgAAAJYAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAADAABQAAADAAAAAwGpAfQABQAAAooCuwAAAIwCigK7AAAB3wAxAQIAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAWFhYWABAACAAQQMg/zgAAAJYAAAAAAABAAAAAAGQAlgAIAAgAAAAAAAzAmoAAAAEAAAAAAACACIAAAAEAAAAAQAOAAAAAAAEAAAAAgAOAA4AAAAEAAAAAwAgAEwAAAAEAAAABAAcABwAAAAEAAAABQAWADgAAAAEAAAABgAcAAAAAAAEAAAABwACACIAAAAEAAAACAACACIAAAAEAAAACQACACIAAAAEAAAACgACACIAAAAEAAAACwACACIAAAAEAAAADAACACIAAAAEAAAADQACACIAAAAEAAAADgACACIAAAAEAAAAEAAOAAAAAAAEAAAAEQAOAA4AAQAAAAAAAAABACoAAQAAAAAAAQAJAHEAAQAAAAAAAgAHAHoAAQAAAAAAAwAUAJsAAQAAAAAABAARAIcAAQAAAAAABQALAJYAAQAAAAAABgAQAHoAAQAAAAAABwABACoAAQAAAAAACAABACoAAQAAAAAACQABACoAAQAAAAAACgABACoAAQAAAAAACwABACoAAQAAAAAADAABACoAAQAAAAAADQABACoAAQAAAAAADgABACoAAQAAAAAAEAAJAHEAAQAAAAAAEQAHAHoAAwABBAkAAAACACIAAwABBAkAAQAOAAAAAwABBAkAAgAOAA4AAwABBAkAAwAgAEwAAwABBAkABAAcABwAAwABBAkABQAWADgAAwABBAkABgAcAAAAAwABBAkABwACACIAAwABBAkACAACACIAAwABBAkACQACACIAAwABBAkACgACACIAAwABBAkACwACACIAAwABBAkADAACACIAAwABBAkADQACACIAAwABBAkADgACACIAAwABBAkAEAAJAHEAAwABBAkAEQAHAHoAUwBlAGcAbwBlACAAVQBJAFIAZQBnAHUAbABhAHIAUwBlAGcAbwBlACAAVQBJACAAUgBlAGcAdQBsAGEAcgBWAGUAcgBzAGkAbwBuACAAMAAuADEAIAA6ACAAUwBlAGcAbwBlACAAVQBJACAAUgBlAGcAdQBsAGEAcgBTZWdvZSBVSVJlZ3VsYXJTZWdvZSBVSSBSZWd1bGFyVmVyc2lvbiAwLjEgOiBTZWdvZSBVSSBSZWd1bGFyAAAAAAEAAwABAAAADAAEACgAAAAGAAQAAQACACAAQf//AAAAIABB////4f/BAAEAAAAAAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEABAEAAQEBE1NlZ29lIFVJUmVndWxhcgABAQEn+BsA+BwC+B0D+B4Ei4v5tPjsBR0AAACPDx0AAACUEYsdAAAAsBIABgEBDB8nKzAxVmVyc2lvbiAwLjFTZWdvZSBVSSBSZWd1bGFyU2Vnb2UgVUlSZWd1bGFyc3BhY2VBAAAAAYsBjAADAQEEBxb5Hg73jg747IuLFffAiwX7KvjsBQ4AAooAAAD6AAACWAAAAAAAAQAAAAAAAAABABAAAmVuAAA=";

// =============================================================================
// Per-platform browser-environment installer
// =============================================================================

type TestPlatform = "darwin" | "linux" | "win32";

const USER_AGENTS: Record<TestPlatform, string> = {
  darwin:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  linux:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  win32:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
};

type FontFixture = { readonly family: string; readonly postscriptName: string; readonly base64: string };

const CATALOGUE_BY_PLATFORM: Record<TestPlatform, readonly FontFixture[]> = {
  // macOS exposes SFNS.ttf under family "System Font" — the alias chain
  // routes SF Pro through this entry. Inter is added so the harness's
  // default text nodes (which use Inter Regular) can also render.
  darwin: [
    { family: "System Font", postscriptName: ".SFNS-Regular", base64: SYSTEM_FONT_BASE64 },
    { family: "Inter", postscriptName: "Inter-Regular", base64: INTER_BASE64 },
  ],
  // Linux: keep "System Font" + Inter in the catalogue ON PURPOSE.
  // The point of the negative test is to prove that even when a host
  // happens to have something named "System Font" indexed, the
  // linux loader refuses to alias SF Pro through it.
  linux: [
    { family: "System Font", postscriptName: "system-font-linux", base64: SYSTEM_FONT_BASE64 },
    { family: "Inter", postscriptName: "Inter-Regular", base64: INTER_BASE64 },
  ],
  // Windows: System Font + the Windows-platform marketing system
  // font ("Segoe UI") + Inter. The loader must reject both as SF Pro
  // aliases.
  win32: [
    { family: "Segoe UI", postscriptName: "SegoeUI-Regular", base64: SEGOE_UI_BASE64 },
    { family: "System Font", postscriptName: "system-font-win32", base64: SYSTEM_FONT_BASE64 },
    { family: "Inter", postscriptName: "Inter-Regular", base64: INTER_BASE64 },
  ],
};

async function installBrowserFontEnv(page: Page, platform: TestPlatform): Promise<void> {
  const userAgent = USER_AGENTS[platform];
  const catalogue = CATALOGUE_BY_PLATFORM[platform];

  // Override userAgent so `detectBrowserFontPlatform()` lands on the
  // intended FontPlatform. Use `Object.defineProperty` on `navigator`
  // because some Chromium builds make the property read-only on the
  // prototype.
  await page.addInitScript((ua: string) => {
    try {
      Object.defineProperty(window.navigator, "userAgent", {
        configurable: true,
        get(): string {
          return ua;
        },
      });
    } catch (_overrideErr) {
      // If the override fails (locked descriptor), fall back to
      // overlaying a fresh navigator object on `window`. The
      // production loader only reads `navigator.userAgent`, so a
      // shadowing assignment is enough. The original throw is
      // intentionally discarded — it carries no information beyond
      // "descriptor was locked", which the fallback already handles.
      void _overrideErr;
      Object.defineProperty(window, "navigator", {
        configurable: true,
        value: { ...window.navigator, userAgent: ua },
      });
    }
  }, userAgent);

  await page.addInitScript((fonts: readonly FontFixture[]) => {
    function base64ToBytes(b64: string): Uint8Array {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) {
        bytes[i] = bin.charCodeAt(i);
      }
      return bytes;
    }

    function makeFakeFace(fixture: FontFixture) {
      const bytes = base64ToBytes(fixture.base64);
      return {
        family: fixture.family,
        fullName: `${fixture.family} Regular`,
        postscriptName: fixture.postscriptName,
        style: "Regular",
        async blob(): Promise<Blob> {
          const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
          return {
            async arrayBuffer() { return ab; },
          } as Blob;
        },
      };
    }

    const fakeFonts = fonts.map(makeFakeFace);
    Object.defineProperty(window, "queryLocalFonts", {
      configurable: true,
      writable: true,
      value: async () => fakeFonts,
    });
  }, catalogue);
}

// =============================================================================
// Tests
// =============================================================================

test.use({ deviceScaleFactor: 2 });

test.describe("Fig editor WebGL — SF Pro physical-alias regression", () => {
  test("[darwin] resolves SF Pro through System Font and enters text-edit", async ({ page }) => {
    await installBrowserFontEnv(page, "darwin");
    const errors = attachErrorCapture(page);

    await page.goto("/?renderer=webgl&fontMode=browser-real");
    await waitForWebGLEditor(page, errors);

    await doubleClickNode(page, SF_PRO_NODE);
    await page.locator("textarea").waitFor({ state: "attached", timeout: 5_000 });

    // No SF-Pro-related error fired during boot or edit. If the
    // alias chain ever silently broke, the WebGL renderer's
    // missing-glyph-contours path would fire here.
    const SF_PRO_FAILURE = /SF Pro|preloadFonts.*SF Pro|ascender metrics for font "SF Pro"/;
    expect(errors.console.some((m) => SF_PRO_FAILURE.test(m))).toBe(false);
    expect(errors.page.some((m) => SF_PRO_FAILURE.test(m))).toBe(false);
  });

  for (const platform of ["linux", "win32"] as const) {
    test(`[${platform}] SF Pro fails fast — alias chain is NOT applied`, async ({ page }) => {
      // On non-darwin platforms the alias chain is empty even when
      // a "System Font" / "Segoe UI" entry exists in the catalogue.
      // The WebGL text renderer surfaces "requires glyph contours"
      // because no font ever resolves for SF Pro. We *expect* that
      // error to fire — its absence would mean the alias chain
      // leaked off macOS, which is exactly the per-environment
      // contract we are locking against.
      await installBrowserFontEnv(page, platform);
      const errors = attachErrorCapture(page);

      await page.goto("/?renderer=webgl&fontMode=browser-real");

      // The editor will fail to render the SF Pro node and never
      // reach `data-webgl-ready`. Poll for the expected error
      // diagnostic instead of waiting for ready state.
      await expect.poll(
        () => errors.page.some((m) => /requires glyph contours for text node|font "SF Pro"/.test(m)),
        {
          timeout: 10_000,
          message: `Expected SF-Pro-related failure on ${platform}, got console=${JSON.stringify(errors.console)} page=${JSON.stringify(errors.page)}`,
        },
      ).toBe(true);

      // Negative shape: the alias chain must NOT have routed the
      // request through "System Font" / "Segoe UI". If a future
      // regression accidentally aliased on these platforms, the
      // editor would have reached ready state and a screenshot
      // would show rendered SF-Pro-using text — neither of which
      // happens here.
      const canvas = page.locator("canvas[data-webgl-ready='true']");
      expect(await canvas.count()).toBe(0);
    });
  }
});

// =============================================================================
// Helpers
// =============================================================================

type ErrorCapture = { readonly console: string[]; readonly page: string[] };

function attachErrorCapture(page: Page): ErrorCapture {
  const capture: ErrorCapture = { console: [], page: [] };
  page.on("console", (message) => {
    if (message.type() === "error") {
      capture.console.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    capture.page.push(error.message);
  });
  return capture;
}

async function waitForWebGLEditor(page: Page, errors: ErrorCapture): Promise<void> {
  try {
    await page.waitForFunction(
      () => {
        const canvas = document.querySelector("canvas");
        const hitArea = document.querySelector("rect[fill='transparent']");
        return Boolean(canvas && hitArea && canvas.getAttribute("data-webgl-ready") === "true");
      },
      { timeout: 10_000 },
    );
  } catch (timeoutErr) {
    // Surface accumulated console / page errors instead of the
    // generic "waitForFunction timeout" — the WebGL canvas only
    // reaches `data-webgl-ready` after every scene-graph build
    // succeeds, so a font-resolution throw upstream of that would
    // hide its real diagnostic inside the timeout.
    const message = [
      `waitForWebGLEditor timed out: ${(timeoutErr as Error).message}`,
      `console errors: ${JSON.stringify(errors.console)}`,
      `page errors: ${JSON.stringify(errors.page)}`,
    ].join("\n");
    throw new Error(message, { cause: timeoutErr });
  }
}

async function doubleClickNode(
  page: Page,
  node: { readonly pageX: number; readonly pageY: number; readonly width: number; readonly height: number },
): Promise<void> {
  const center = await page.evaluate(
    ({ pageX, pageY, width, height }) => {
      const rect = Array.from(document.querySelectorAll<SVGRectElement>("rect[fill='transparent']")).find((candidate) => {
        const x = Number(candidate.getAttribute("x"));
        const y = Number(candidate.getAttribute("y"));
        const candidateWidth = Number(candidate.getAttribute("width"));
        const candidateHeight = Number(candidate.getAttribute("height"));
        return (
          Math.abs(x - pageX) < 1 &&
          Math.abs(y - pageY) < 1 &&
          Math.abs(candidateWidth - width) < 1 &&
          Math.abs(candidateHeight - height) < 1
        );
      }) ?? null;
      if (!rect) {
        return null;
      }
      const bounds = rect.getBoundingClientRect();
      return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    },
    node,
  );

  if (!center) {
    throw new Error(`Hit-area rect not found for node at (${node.pageX}, ${node.pageY})`);
  }
  await page.mouse.dblclick(center.x, center.y);
}
