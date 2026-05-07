/**
 * @file Bundle smoke test — loads the actual `dist/webview.js` (the
 * bundled output that ships to VS Code) under the same Content
 * Security Policy the extension applies, and asserts the script
 * actually runs.
 *
 * The Vite-aliased harness (`viewer.e2e.ts`) is great for product
 * regressions but it bypasses the production bundler, so it cannot
 * catch failures specific to the bun-built output:
 *   - `ReferenceError: module_zstd_codec is not defined`
 *     (zstd-codec CJS shape vs bun's module hoisting)
 *   - `ReferenceError: <minified-name> is not defined`
 *     (bun --minify variable renaming bugs)
 *   - CSP violations against `'unsafe-eval'` introduced by a new
 *     dependency
 *
 * This spec runs the production bundle in the same VS Code-style
 * webview CSP, so any of the above fails CI before a developer
 * notices in their Extension Development Host.
 */

import { test, expect, type ConsoleMessage, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(here, "../../dist");

type DiagnosticEntry = { readonly kind: "console" | "pageerror"; readonly text: string };

function makeRecorder(diagnostics: DiagnosticEntry[]) {
  return {
    onConsole: (msg: ConsoleMessage) => {
      diagnostics.push({ kind: "console", text: `[${msg.type()}] ${msg.text()}` });
    },
    onPageError: (error: Error) => {
      diagnostics.push({
        kind: "pageerror",
        text: `${error.name}: ${error.message}\n${error.stack ?? ""}`,
      });
    },
  };
}

function buildHarnessHtml(scriptPath: string, nonce: string): string {
  // Mirror the production CSP from `fig-viewer-provider.ts:buildWebviewHtml`.
  const csp = [
    "default-src 'none'",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    `script-src 'nonce-${nonce}' 'unsafe-eval'`,
  ].join("; ");
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <title>higma-vsc-plugin bundle smoke</title>
</head>
<body>
  <div id="higma-fig-root"></div>
  <script nonce="${nonce}">
    // Stub the VS Code webview API so the bundle's eager
    // \`postToExtension({ type: "webview/ready" })\` resolves without
    // throwing. The captured messages are mirrored onto window so the
    // test can read them.
    (function () {
      const captured = [];
      window.__bundleSmoke = { captured: captured, error: null };
      window.acquireVsCodeApi = function () {
        return {
          postMessage: function (msg) { captured.push(msg); },
          setState: function () {},
          getState: function () { return undefined; },
        };
      };
      window.addEventListener("error", function (event) {
        window.__bundleSmoke.error = event.error
          ? (event.error.message + "\\n" + (event.error.stack || ""))
          : (event.message || String(event));
      });
    })();
  </script>
  <script type="module" nonce="${nonce}" src="${scriptPath}"></script>
</body>
</html>`;
}

type BundleSmoke = {
  readonly captured: ReadonlyArray<{ readonly type?: unknown }>;
  readonly error: string | null;
};

async function captureSmokeState(page: Page): Promise<BundleSmoke> {
  const value = (await page.evaluate(() => window.__bundleSmoke ?? null)) as BundleSmoke | null;
  if (!value) {
    throw new Error("bundle smoke harness did not initialise window.__bundleSmoke");
  }
  return value;
}

test("bundled dist/webview.js executes under VS Code CSP and posts webview/ready", async ({ page }) => {
  const diagnostics: DiagnosticEntry[] = [];
  const recorder = makeRecorder(diagnostics);
  page.on("console", recorder.onConsole);
  page.on("pageerror", recorder.onPageError);

  // Serve both the harness HTML and the bundle from a synthetic
  // origin via `page.route`. Using a real URL (rather than
  // `setContent`) gives the document a base href the script-tag
  // src can resolve against, and keeps the page's CSP separate from
  // about:blank quirks.
  const bundlePath = resolve(distDir, "webview.js");
  const bundle = await readFile(bundlePath, "utf-8");
  const nonce = "smoke-test-nonce";
  const harnessHost = "https://higma-bundle-smoke.test";
  const harnessHtml = buildHarnessHtml("/webview.js", nonce);

  await page.route(`${harnessHost}/**`, async (route) => {
    const url = route.request().url();
    if (url === `${harnessHost}/`) {
      await route.fulfill({ status: 200, contentType: "text/html", body: harnessHtml });
      return;
    }
    if (url === `${harnessHost}/webview.js`) {
      await route.fulfill({ status: 200, contentType: "application/javascript", body: bundle });
      return;
    }
    await route.fulfill({ status: 404, body: `unmocked: ${url}` });
  });

  await page.goto(`${harnessHost}/`, { waitUntil: "load" });

  // The bundle posts `webview/ready` synchronously at module
  // evaluation. If it ever stops doing that the rest of the
  // extension stack falls apart silently in production, so this
  // assertion is the gate.
  try {
    await page.waitForFunction(
      () => (window.__bundleSmoke?.captured ?? []).some(
        (m) => (m as { type?: unknown }).type === "webview/ready",
      ),
      undefined,
      { timeout: 8_000 },
    );
  } catch (timeoutError: unknown) {
    const smoke = await captureSmokeState(page).catch(() => null);
    const detail = [
      `bundled webview never posted webview/ready under VS Code-style CSP`,
      `runtime error: ${smoke?.error ?? "(none captured)"}`,
      `captured messages (${smoke?.captured.length ?? 0}):`,
      ...((smoke?.captured ?? []) as Array<{ type?: unknown }>).map(
        (m) => `  - ${JSON.stringify(m).slice(0, 240)}`,
      ),
      `diagnostics (${diagnostics.length}):`,
      ...diagnostics.map((d) => `  [${d.kind}] ${d.text.slice(0, 240)}`),
    ].join("\n");
    throw new Error(detail);
  }

  const smoke = await captureSmokeState(page);
  expect(smoke.error, `runtime error in bundle: ${smoke.error}`).toBeNull();
  expect(diagnostics.filter((d) => d.kind === "pageerror"), "pageerror events should be empty").toEqual([]);
});

declare global {
  interface Window {
    __bundleSmoke?: BundleSmoke;
  }
}
