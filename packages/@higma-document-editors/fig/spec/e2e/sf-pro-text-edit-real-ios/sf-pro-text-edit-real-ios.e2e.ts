/** @file Source-backed fixture text-edit regression for SF Pro layout metrics. */

import { expect, test, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import {
  enterFigEditorTextEditByGuid,
  waitForFigEditorWebGLSurfacesSettled,
  waitForFigEditorOperationSurface,
} from "../fig-editor-operation-surface-driver/fig-editor-operation-surface-driver";
import type { FigEditorOperationSurfaceGlobalThis } from "../../../src/operation-surface/fig-editor-operation-surface-types";
import {
  hasMacOsSfProLocalFontFiles,
  installMacOsSfProLocalFontAccess,
} from "../shared/macos-sf-pro-local-font-access";
import { discoverSourceBackedPair, resolveFixture } from "../shared/real-fig-fixture-discovery";

const SOURCE_BACKED_PAIR = discoverSourceBackedPair();
const SVG_VIEWPORT_SURFACE_SELECTOR = "[role='group'][aria-label='Fig editor viewport surface'] svg[aria-hidden='true']";

type RendererUnderTest = "svg" | "webgl";

type TextEditTarget = {
  readonly guidKey: string;
  readonly replacementText: string;
};

type ErrorCapture = {
  readonly console: string[];
  readonly page: string[];
};

const TEXT_EDIT_TARGETS: readonly TextEditTarget[] = [
  { guidKey: "1:1196", replacementText: "Headline edited" },
  { guidKey: "8:22778", replacementText: "Your subtitle edited" },
  { guidKey: "2310:42144", replacementText: "Apps edited" },
];

test.describe("real source-backed fixture SF Pro text edit", () => {
  test.skip(
    SOURCE_BACKED_PAIR === undefined ||
      !existsSync(resolveFixture(SOURCE_BACKED_PAIR.primary)) ||
      !existsSync(resolveFixture(SOURCE_BACKED_PAIR.source)),
    "requires a source-backed fixture pair under dev/public/fig-fixtures.tmp",
  );
  test.skip(!hasMacOsSfProLocalFontFiles(), "requires macOS SFNS.ttf and SFNSRounded.ttf");

  for (const renderer of ["svg", "webgl"] as const) {
    test(`edits SF Pro text without missing font metrics in ${renderer}`, async ({ page }) => {
      test.setTimeout(90_000);
      const errors = attachErrorCapture(page);
      await installMacOsSfProLocalFontAccess(page);
      await page.goto(`/?${routeParams(renderer).toString()}`);
      await waitForEditorReady(page, renderer);

      for (const target of TEXT_EDIT_TARGETS) {
        const initialCharacters = await readTextCharacters(page, target.guidKey);
        await enterFigEditorTextEditByGuid(page, target.guidKey);
        await expect.poll(() => activeCanvasTextEditTextareaValue(page), {
          message: `TEXT ${target.guidKey} should mount and focus the canvas text edit overlay`,
          timeout: 10_000,
        }).toBe(initialCharacters);
        await setActiveCanvasTextEditTextareaValue(page, target.replacementText);
        await expect.poll(() => activeCanvasTextEditTextareaValue(page), {
          message: `TEXT ${target.guidKey} should update the canvas textarea value`,
          timeout: 10_000,
        }).toBe(target.replacementText);
        assertNoCapturedPageErrors(errors, `after editing TEXT ${target.guidKey}`);
        await expect.poll(() => readTextCharacters(page, target.guidKey), {
          message: `TEXT ${target.guidKey} should accept edited characters through FigTextEditOverlay`,
          timeout: 10_000,
        }).toBe(target.replacementText);
      }

      expect(relevantFontMetricErrors(errors)).toEqual([]);
    });
  }
});

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

async function waitForEditorReady(page: Page, renderer: RendererUnderTest): Promise<void> {
  await waitForFigEditorOperationSurface(page);
  await expect(page.getByRole("status", { name: "Browser font preload pending" })).toHaveCount(0, { timeout: 45_000 });
  if (renderer === "webgl") {
    await waitForFigEditorWebGLSurfacesSettled(page);
    return;
  }
  await expect(page.locator(SVG_VIEWPORT_SURFACE_SELECTOR).first()).toBeVisible({ timeout: 45_000 });
}

async function readTextCharacters(page: Page, guidKey: string): Promise<string> {
  return page.evaluate((targetGuidKey) => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    return api.text.readCharacters(targetGuidKey);
  }, guidKey);
}

async function setActiveCanvasTextEditTextareaValue(page: Page, text: string): Promise<void> {
  await page.evaluate((nextText) => {
    const active = document.activeElement;
    if (!(active instanceof HTMLTextAreaElement)) {
      throw new Error("real iOS text edit test requires an active canvas textarea");
    }
    if (globalThis.getComputedStyle(active).opacity !== "0") {
      throw new Error("real iOS text edit test active textarea is not the canvas text edit textarea");
    }
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (valueSetter === undefined) {
      throw new Error("real iOS text edit test cannot resolve native textarea value setter");
    }
    valueSetter.call(active, nextText);
    active.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: nextText,
      inputType: "insertReplacementText",
    }));
  }, text);
}

async function activeCanvasTextEditTextareaValue(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLTextAreaElement)) {
      return null;
    }
    if (globalThis.getComputedStyle(active).opacity !== "0") {
      return null;
    }
    return active.value;
  });
}

function relevantFontMetricErrors(errors: ErrorCapture): readonly string[] {
  const pattern = /Text layout requires (ascender|descender|character) metrics for font "SF Pro|preloadFonts: font "SF Pro/;
  return [...errors.console, ...errors.page].filter((message) => pattern.test(message));
}

function assertNoCapturedPageErrors(errors: ErrorCapture, owner: string): void {
  if (errors.page.length === 0) {
    return;
  }
  throw new Error(`${owner} captured page errors: ${JSON.stringify(errors.page)}`);
}

function routeParams(renderer: RendererUnderTest): URLSearchParams {
  if (SOURCE_BACKED_PAIR === undefined) {
    throw new Error("source-backed pair not discovered");
  }
  return new URLSearchParams({
    renderer,
    panel: "all",
    fontMode: "browser-real",
    figUrl: fileUrl(resolveFixture(SOURCE_BACKED_PAIR.primary)),
    sourceUrl: fileUrl(resolveFixture(SOURCE_BACKED_PAIR.source)),
  });
}

function fileUrl(path: string): string {
  return `/@fs${path}`;
}
