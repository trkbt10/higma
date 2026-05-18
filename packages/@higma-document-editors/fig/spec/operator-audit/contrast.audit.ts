/**
 * @file Runtime contrast audit — walks the rendered property panel and
 * for every visible text-bearing element computes the WCAG luminance
 * contrast against its nearest opaque ancestor background. Reports
 * every pair that fails AA (4.5:1) for normal text or AA-large
 * (3.0:1) for elements with font-size >= 18px or >= 14px bold.
 *
 * This is the runtime inventory mechanism — static-token analysis
 * misses spread merges, theme variables, and dynamic state colors.
 * Reading getComputedStyle on the actual DOM is the only honest way
 * to know what the operator sees.
 */

import { expect, test, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = resolve(__dirname, "results");

type ContrastPair = {
  readonly text: string;
  readonly selector: string;
  readonly color: string;
  readonly bg: string;
  readonly bgFrom: string;
  readonly fontSize: number;
  readonly fontWeight: number;
  readonly ratio: number;
  readonly threshold: number;
  readonly passes: boolean;
};

async function locateCanvasViewport(page: Page) {
  const handle = await page.evaluateHandle(() => {
    const svgs = Array.from(document.querySelectorAll("svg"));
    let best: { el: SVGSVGElement; area: number } | null = null;
    for (const el of svgs) {
      const rect = el.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (!best || area > best.area) {
        best = { el, area };
      }
    }
    return best?.el ?? null;
  });
  return handle.asElement();
}

async function dragOnCanvas(page: Page, offsetX = 240, offsetY = 180) {
  const canvas = await locateCanvasViewport(page);
  if (!canvas) {
    throw new Error("canvas svg not found");
  }
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error("canvas svg has no layout box");
  }
  const sx = box.x + box.width * 0.35;
  const sy = box.y + box.height * 0.35;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + offsetX, sy + offsetY, { steps: 12 });
  await page.mouse.up();
}

/** Open editor + create a rectangle + open Properties tab. */
async function openWithRectangle(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New Document" }).click();
  await expect(page.getByRole("button", { name: /Rectangle \(R\)/ })).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: /Rectangle \(R\)/ }).click();
  await dragOnCanvas(page);
  await page.getByRole("treeitem", { name: /Rectangle/ }).click();
  await page.getByRole("tab", { name: "Properties" }).click();
  await expect(page.getByLabel("X").first()).toBeVisible();
}

async function collectContrastPairs(page: Page): Promise<ContrastPair[]> {
  return page.evaluate(() => {
    type Rgb = { r: number; g: number; b: number; a: number };
    function parseRgb(s: string): Rgb | null {
      const m = /rgba?\(([^)]+)\)/.exec(s);
      if (!m) return null;
      const parts = m[1]!.split(",").map((p) => parseFloat(p.trim()));
      if (parts.length < 3) return null;
      return { r: parts[0]!, g: parts[1]!, b: parts[2]!, a: parts[3] ?? 1 };
    }
    function compose(top: Rgb, base: Rgb): Rgb {
      const a = top.a;
      return {
        r: top.r * a + base.r * (1 - a),
        g: top.g * a + base.g * (1 - a),
        b: top.b * a + base.b * (1 - a),
        a: 1,
      };
    }
    function srgbToLin(c: number): number {
      const x = c / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    }
    function lum(rgb: Rgb): number {
      return 0.2126 * srgbToLin(rgb.r) + 0.7152 * srgbToLin(rgb.g) + 0.0722 * srgbToLin(rgb.b);
    }
    function contrastRatio(fg: Rgb, bg: Rgb): number {
      const l1 = lum(fg);
      const l2 = lum(bg);
      const hi = Math.max(l1, l2);
      const lo = Math.min(l1, l2);
      return (hi + 0.05) / (lo + 0.05);
    }
    function effectiveBg(el: Element): { bg: Rgb; from: string } {
      let cur: Element | null = el.parentElement;
      const stack: { el: Element; c: Rgb }[] = [];
      while (cur) {
        const cs = getComputedStyle(cur);
        const c = parseRgb(cs.backgroundColor);
        if (c && c.a > 0) stack.push({ el: cur, c });
        if (c && c.a >= 1) break;
        cur = cur.parentElement;
      }
      let bg: Rgb = { r: 255, g: 255, b: 255, a: 1 };
      for (let i = stack.length - 1; i >= 0; i--) {
        bg = compose(stack[i]!.c, bg);
      }
      return { bg, from: stack[0]?.el?.tagName ?? "document" };
    }
    function getSelector(el: Element): string {
      const parts: string[] = [];
      let cur: Element | null = el;
      let depth = 0;
      while (cur && depth < 4) {
        let s = cur.tagName.toLowerCase();
        const role = cur.getAttribute("role");
        const label = cur.getAttribute("aria-label");
        if (role) s += "[role=" + role + "]";
        if (label) s += "[aria-label=" + JSON.stringify(label) + "]";
        parts.unshift(s);
        cur = cur.parentElement;
        depth++;
      }
      return parts.join(" > ");
    }
    const visited = new WeakSet<Element>();
    const found: ContrastPair[] = [];
    const root = document.body;
    function walk(el: Element | null): void {
      if (!el || visited.has(el)) return;
      visited.add(el);
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) === 0) return;
      let textContent = "";
      for (const node of Array.from(el.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE) {
          textContent += node.textContent || "";
        }
      }
      textContent = textContent.trim();
      if (textContent.length > 0 && textContent.length < 200) {
        const fg = parseRgb(cs.color);
        const { bg, from } = effectiveBg(el);
        if (fg) {
          const composedFg = fg.a < 1 ? compose(fg, bg) : { r: fg.r, g: fg.g, b: fg.b, a: 1 };
          const ratio = contrastRatio(composedFg, bg);
          const fs = parseFloat(cs.fontSize);
          const fw = parseInt(cs.fontWeight, 10) || 400;
          const isLargeText = fs >= 18 || (fs >= 14 && fw >= 700);
          const threshold = isLargeText ? 3.0 : 4.5;
          found.push({
            text: textContent.slice(0, 80),
            selector: getSelector(el),
            color: cs.color,
            bg: "rgb(" + Math.round(bg.r) + ", " + Math.round(bg.g) + ", " + Math.round(bg.b) + ")",
            bgFrom: from,
            fontSize: fs,
            fontWeight: fw,
            ratio: Math.round(ratio * 100) / 100,
            threshold,
            passes: ratio >= threshold,
          });
        }
      }
      for (const child of Array.from(el.children)) {
        walk(child);
      }
    }
    walk(root);
    return found;
  }) as Promise<ContrastPair[]>;
}

test.describe("contrast audit — property panel surfaces", () => {
  test("rectangle scenario — full property chrome", async ({ page }) => {
    await openWithRectangle(page);
    await page.getByLabel("Fill paint type 1").selectOption("GRADIENT_LINEAR");
    await page.getByRole("button", { name: "Add effect" }).click();
    await page.getByRole("button", { name: "Add stroke" }).click();
    await page.getByRole("button", { name: /^Layout Constraints/ }).click();
    await page.getByRole("button", { name: /^Export 0$/ }).click();
    await page.getByRole("button", { name: "Add export preset" }).click();
    await page.waitForTimeout(200);

    const pairs = await collectContrastPairs(page);
    const failures = pairs.filter((p) => !p.passes);
    writeFileSync(
      resolve(RESULTS_DIR, "contrast-inventory-rectangle.json"),
      JSON.stringify({ totalSampled: pairs.length, failures, allPairs: pairs }, null, 2),
    );
    await page.screenshot({ path: resolve(RESULTS_DIR, "contrast-context-rectangle.png"), fullPage: false });
    expect(pairs.length).toBeGreaterThan(0);
  });

  test("frame scenario — auto layout chrome", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "New Document" }).click();
    await expect(page.getByRole("button", { name: /Frame \(F\)/ })).toBeVisible({ timeout: 5_000 });
    await page.getByRole("button", { name: /Frame \(F\)/ }).click();
    await dragOnCanvas(page);
    await page.getByRole("treeitem", { name: /Frame/ }).click();
    await page.getByRole("tab", { name: "Properties" }).click();
    await page.getByLabel("Auto layout mode").selectOption("HORIZONTAL");
    await page.waitForTimeout(200);

    const pairs = await collectContrastPairs(page);
    const failures = pairs.filter((p) => !p.passes);
    writeFileSync(
      resolve(RESULTS_DIR, "contrast-inventory-frame.json"),
      JSON.stringify({ totalSampled: pairs.length, failures, allPairs: pairs }, null, 2),
    );
    await page.screenshot({ path: resolve(RESULTS_DIR, "contrast-context-frame.png"), fullPage: false });
    expect(pairs.length).toBeGreaterThan(0);
  });
});
