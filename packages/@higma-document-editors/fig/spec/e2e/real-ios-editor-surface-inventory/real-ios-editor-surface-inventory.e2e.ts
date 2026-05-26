/** @file Real source-backed fixture editor-surface inventory regression. */

import { expect, test, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import {
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

type InventoryTarget = {
  readonly guidKey: string;
  readonly typeName: string;
};

type PageInventory = {
  readonly pageGuidKey: string;
  readonly pageName: string | undefined;
  readonly targets: readonly InventoryTarget[];
};

type ErrorCapture = {
  readonly console: string[];
  readonly page: string[];
};

const INVENTORY_TARGETS: readonly InventoryTarget[] = [
  { guidKey: "2313:67245", typeName: "FRAME" },
  { guidKey: "2313:70958", typeName: "SECTION" },
  { guidKey: "2316:8253", typeName: "ROUNDED_RECTANGLE" },
  { guidKey: "2310:42143", typeName: "ELLIPSE" },
  { guidKey: "2310:47451", typeName: "BOOLEAN_OPERATION" },
  { guidKey: "2310:47571", typeName: "VECTOR" },
  { guidKey: "1:1196", typeName: "TEXT" },
  { guidKey: "1:1711", typeName: "SYMBOL" },
  { guidKey: "2316:9650", typeName: "INSTANCE" },
  { guidKey: "2305:12723", typeName: "INSTANCE" },
  { guidKey: "2304:20212", typeName: "INSTANCE" },
  { guidKey: "2307:20423", typeName: "INSTANCE" },
  { guidKey: "2307:21368", typeName: "INSTANCE" },
  { guidKey: "2307:32535", typeName: "INSTANCE" },
  { guidKey: "2310:42407", typeName: "INSTANCE" },
  { guidKey: "2313:67557", typeName: "INSTANCE" },
];

const STATUS_BAR_COMPONENT_PROPERTY_INSTANCE_GUID_KEYS = new Set([
  "2307:20423",
  "2307:21368",
  "2307:32535",
  "2310:42407",
  "2313:67557",
]);
const STATUS_BAR_COMPONENT_PROPERTY_DEF_GUID_KEY = "5466:4";
const STATUS_BAR_COMPONENT_SYMBOL_GUID_KEY = "2307:20393";

test.describe("real source-backed fixture editor surface inventory", () => {
  test.skip(
    SOURCE_BACKED_PAIR === undefined ||
      !existsSync(resolveFixture(SOURCE_BACKED_PAIR.primary)) ||
      !existsSync(resolveFixture(SOURCE_BACKED_PAIR.source)),
    "requires a source-backed fixture pair under dev/public/fig-fixtures.tmp",
  );
  test.skip(!hasMacOsSfProLocalFontFiles(), "requires macOS SFNS.ttf and SFNSRounded.ttf");

  for (const renderer of ["svg", "webgl"] as const) {
    test(`selects active-page editor node types and validates interactive surfaces in ${renderer}`, async ({ page }) => {
      test.setTimeout(180_000);
      const errors = captureEditorErrors(page);
      await installMacOsSfProLocalFontAccess(page);
      await page.goto(`/?${routeParams(renderer).toString()}`);
      await waitForEditorReady(page, renderer);
      await expandFramedLayer(page);
      await assertNamedInteractiveEditorControls(page);

      for (const pageInventory of await collectAllPageEditorInventoryTargets(page)) {
        await setActivePageByGuid(page, pageInventory.pageGuidKey, renderer);
        await assertNamedInteractiveEditorControls(page);
        for (const target of pageInventory.targets) {
          await selectNodeByGuid(page, target.guidKey);
          await expect(page.getByText(`${target.typeName} · ${target.guidKey}`)).toBeVisible({ timeout: 10_000 });
          await assertStatusBarInheritedComponentProperty(page, target.guidKey);
          await assertNamedInteractiveEditorControls(page);
          assertNoCapturedEditorErrors(
            errors,
            `selecting ${target.typeName} ${target.guidKey} on page ${pageInventory.pageName ?? pageInventory.pageGuidKey}`,
          );
        }
      }
      await assertEveryResolvedInstanceSelectionIsStable(page, renderer, errors);
    });
  }
});

function captureEditorErrors(page: Page): ErrorCapture {
  const errors: ErrorCapture = { console: [], page: [] };
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.console.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    errors.page.push(error.message);
  });
  return errors;
}

async function assertStatusBarInheritedComponentProperty(page: Page, guidKey: string): Promise<void> {
  if (!STATUS_BAR_COMPONENT_PROPERTY_INSTANCE_GUID_KEYS.has(guidKey)) {
    return;
  }
  const property = await componentPropertySnapshot(page, guidKey, STATUS_BAR_COMPONENT_PROPERTY_DEF_GUID_KEY);
  expect(property.defGuidKey).toBe(STATUS_BAR_COMPONENT_PROPERTY_DEF_GUID_KEY);
  expect(property.name).toBeTruthy();
  expect(property.type).toBe("TEXT");
  expect(property.value).toBeDefined();
  expect(typeof property.isOverridden).toBe("boolean");
  expect(property.symbolGuidKey).toBe(STATUS_BAR_COMPONENT_SYMBOL_GUID_KEY);
  expect(property.symbolName).toBeTruthy();
  const propertyTextbox = page.getByRole("textbox", { name: new RegExp(`^Component property ${property.name}$`) });
  await expect(propertyTextbox).toBeVisible();
  await expect(propertyTextbox).not.toHaveValue("");
}

type ComponentPropertySnapshot = {
  readonly defGuidKey: string;
  readonly name: string;
  readonly type: string;
  readonly value: unknown;
  readonly isOverridden: boolean;
  readonly symbolGuidKey: string;
  readonly symbolName: string | undefined;
};

async function componentPropertySnapshot(
  page: Page,
  guidKey: string,
  defGuidKey: string,
): Promise<ComponentPropertySnapshot> {
  return page.evaluate(({ targetGuidKey, targetDefGuidKey }) => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    const property = api.component.properties(targetGuidKey)
      .find((candidate) => candidate.defGuidKey === targetDefGuidKey);
    if (property === undefined) {
      throw new Error(`Component property ${targetDefGuidKey} is not resolved on ${targetGuidKey}`);
    }
    return property;
  }, { targetGuidKey: guidKey, targetDefGuidKey: defGuidKey });
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

async function expandFramedLayer(page: Page): Promise<void> {
  const layers = page.getByRole("tree", { name: "Layers" });
  const expandButton = layers.getByRole("button", { name: /^Expand / }).first();
  await expect(expandButton).toBeVisible({ timeout: 10_000 });
  const treeitemCountBefore = await layers.getByRole("treeitem").count();
  await expandButton.click();
  await expect.poll(() => layers.getByRole("treeitem").count(), { timeout: 10_000 }).toBeGreaterThan(treeitemCountBefore);
}

async function collectAllPageEditorInventoryTargets(page: Page): Promise<readonly PageInventory[]> {
  return page.evaluate((explicitTargets) => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    return api.document.pages().map((pageNode) => {
      const pageNodeSnapshots = [pageNode, ...api.document.descendants(pageNode.guidKey)];
      const nodesByGuidKey = new Map(pageNodeSnapshots.map((node) => [node.guidKey, node]));
      const targetsByGuidKey = new Map<string, InventoryTarget>();
      const seenTypeNames = new Set<string>();
      for (const node of pageNodeSnapshots) {
        if (!seenTypeNames.has(node.type)) {
          seenTypeNames.add(node.type);
          targetsByGuidKey.set(node.guidKey, { guidKey: node.guidKey, typeName: node.type });
        }
      }
      for (const explicitTarget of explicitTargets) {
        const node = nodesByGuidKey.get(explicitTarget.guidKey);
        if (node !== undefined) {
          targetsByGuidKey.set(explicitTarget.guidKey, { guidKey: node.guidKey, typeName: node.type });
        }
      }
      return {
        pageGuidKey: pageNode.guidKey,
        pageName: pageNode.name,
        targets: Array.from(targetsByGuidKey.values()),
      };
    });
  }, INVENTORY_TARGETS);
}

async function collectAllPageResolvedInstanceTargets(page: Page): Promise<readonly PageInventory[]> {
  return page.evaluate(() => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    return api.document.pages().map((pageNode) => {
      const instances = api.document.descendants(pageNode.guidKey)
        .filter((node) => node.type === "INSTANCE")
        .filter((node) => api.document.symbolResolution(node.guidKey).effectiveSymbolGuidKey !== undefined)
        .map((node) => ({ guidKey: node.guidKey, typeName: node.type }));
      return {
        pageGuidKey: pageNode.guidKey,
        pageName: pageNode.name,
        targets: instances,
      };
    });
  });
}

async function assertEveryResolvedInstanceSelectionIsStable(
  page: Page,
  renderer: RendererUnderTest,
  errors: ErrorCapture,
): Promise<void> {
  for (const pageInventory of await collectAllPageResolvedInstanceTargets(page)) {
    await setActivePageByGuid(page, pageInventory.pageGuidKey, renderer);
    for (const target of pageInventory.targets) {
      await selectNodeByGuid(page, target.guidKey);
      await expect(page.getByText(`INSTANCE · ${target.guidKey}`)).toBeVisible({ timeout: 10_000 });
      assertNoCapturedEditorErrors(
        errors,
        `selecting resolved INSTANCE ${target.guidKey} on page ${pageInventory.pageName ?? pageInventory.pageGuidKey}`,
      );
    }
  }
}

async function setActivePageByGuid(
  page: Page,
  pageGuidKey: string,
  renderer: RendererUnderTest,
): Promise<void> {
  await page.evaluate((targetPageGuidKey) => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    api.page.setActive(targetPageGuidKey);
  }, pageGuidKey);
  await expect.poll(() => page.evaluate(() => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    return api.document.activePage().guidKey;
  })).toBe(pageGuidKey);
  await waitForEditorReady(page, renderer);
}

async function assertNamedInteractiveEditorControls(page: Page): Promise<void> {
  const unnamedControls = await page.evaluate(() => {
    function isVisible(element: Element): boolean {
      const rect = element.getBoundingClientRect();
      const style = globalThis.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    }
    function textFromIds(ids: string | null): string {
      if (ids === null) {
        return "";
      }
      return ids
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
        .filter((text) => text.length > 0)
        .join(" ");
    }
    function formControlAssociatedLabelText(element: Element): string {
      if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLSelectElement) && !(element instanceof HTMLTextAreaElement)) {
        return "";
      }
      return Array.from(element.labels ?? [])
        .map((label) => label.textContent?.trim() ?? "")
        .filter((text) => text.length > 0)
        .join(" ");
    }
    function controlName(element: Element): string {
      const ariaLabel = element.getAttribute("aria-label")?.trim() ?? "";
      if (ariaLabel.length > 0) {
        return ariaLabel;
      }
      const labelledBy = textFromIds(element.getAttribute("aria-labelledby")).trim();
      if (labelledBy.length > 0) {
        return labelledBy;
      }
      const labels = formControlAssociatedLabelText(element);
      if (labels.length > 0) {
        return labels;
      }
      const text = element.textContent?.trim() ?? "";
      if (text.length > 0) {
        return text;
      }
      const title = element.getAttribute("title")?.trim() ?? "";
      if (title.length > 0) {
        return title;
      }
      return element.getAttribute("placeholder")?.trim() ?? "";
    }
    const selector = [
      "button",
      "input:not([type='hidden'])",
      "select",
      "textarea",
      "[role='button']",
      "[role='switch']",
      "[role='tab']",
      "[role='tree']",
      "[role='treeitem']",
      "[role='status']",
    ].join(",");
    return Array.from(document.querySelectorAll(selector))
      .filter(isVisible)
      .filter((element) => controlName(element).length === 0)
      .map((element) => ({
        tagName: element.tagName.toLowerCase(),
        role: element.getAttribute("role"),
        type: element.getAttribute("type"),
        className: element.getAttribute("class"),
      }));
  });
  expect(unnamedControls).toEqual([]);
}

async function selectNodeByGuid(page: Page, guidKey: string): Promise<void> {
  await page.evaluate((targetGuidKey) => {
    const api = (globalThis as FigEditorOperationSurfaceGlobalThis).higmaFigEditor;
    if (api === undefined) {
      throw new Error("globalThis.higmaFigEditor is not published");
    }
    api.selection.select(targetGuidKey);
  }, guidKey);
}

function assertNoCapturedEditorErrors(errors: ErrorCapture, owner: string): void {
  if (errors.page.length === 0 && errors.console.length === 0) {
    return;
  }
  throw new Error(`${owner} captured editor errors: page=${JSON.stringify(errors.page)} console=${JSON.stringify(errors.console)}`);
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
