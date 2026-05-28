/**
 * @file E2E tests that boot the webview entry the same way the VS Code
 * extension does and probe both the happy path and the error-forwarding
 * path. A blank webview in production (which leaves no trace in the
 * extension host terminal) should now surface here as a captured
 * `webview/log` error and a render-time error UI.
 */

import { test, expect, type ConsoleMessage, type Page } from "@playwright/test";

type CapturedMessage = { readonly type: string; readonly [key: string]: unknown };

type E2EState = "init" | "ready-received" | "loaded-sent" | "error";

type E2EHandle = {
  readonly state: E2EState;
  readonly scenario: "small" | "large" | "garbage";
  readonly captured: ReadonlyArray<CapturedMessage>;
  readonly fixtureName: string;
};

type DiagnosticEntry = { readonly kind: "console" | "pageerror"; readonly text: string };

function makeRecorder(diagnostics: DiagnosticEntry[]) {
  return {
    onConsole: (msg: ConsoleMessage) => {
      const text = msg.text();
      if (msg.type() === "error" || msg.type() === "warning") {
        diagnostics.push({ kind: "console", text: `[${msg.type()}] ${text}` });
      }
    },
    onPageError: (error: Error) => {
      diagnostics.push({ kind: "pageerror", text: `${error.name}: ${error.message}\n${error.stack ?? ""}` });
    },
  };
}

async function dumpState(page: Page, diagnostics: ReadonlyArray<DiagnosticEntry>, label: string): Promise<string> {
  const handle = (await page.evaluate(() => window.__higmaE2E ?? null)) as E2EHandle | null;
  return [
    `--- ${label} ---`,
    `harness state: ${handle?.state ?? "unavailable"}`,
    `scenario: ${handle?.scenario ?? "unknown"}`,
    `captured messages (${handle?.captured.length ?? 0}):`,
    ...((handle?.captured ?? []) as CapturedMessage[]).map((m) => `  - ${JSON.stringify(m).slice(0, 240)}`),
    `diagnostics (${diagnostics.length}):`,
    ...diagnostics.map((d) => `  [${d.kind}] ${d.text}`),
  ].join("\n");
}

async function waitForReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => window.__higmaE2E?.state === "ready-received" || window.__higmaE2E?.state === "loaded-sent",
    undefined,
    { timeout: 15_000 },
  );
}

test("small fixture renders the viewer workspace without diagnostics", async ({ page }) => {
  const diagnostics: DiagnosticEntry[] = [];
  const recorder = makeRecorder(diagnostics);
  page.on("console", recorder.onConsole);
  page.on("pageerror", recorder.onPageError);

  await page.goto("/");

  await waitForReady(page).catch(async (err: unknown) => {
    throw new Error(`webview never posted webview/ready\n${await dumpState(page, diagnostics, "ready timeout")}\n${err}`);
  });

  // The header was removed when zoom/Fit moved into the VS Code status
  // bar; `.higma-fig-workspace` now serves the same "viewer mounted and
  // consumed fig/loaded" signal — it renders only after the document
  // parses successfully (the loading and error states use sibling DOM).
  await expect(page.locator(".higma-fig-workspace")).toBeVisible({ timeout: 15_000 });

  const handle = (await page.evaluate(() => window.__higmaE2E)) as E2EHandle | undefined;
  const webviewErrors = (handle?.captured ?? []).filter((m) => m.type === "webview/log" && m.level === "error");
  const pageErrors = diagnostics.filter((d) => d.kind === "pageerror");
  if (pageErrors.length + webviewErrors.length > 0) {
    throw new Error(`small fixture produced fatal diagnostics\n${await dumpState(page, diagnostics, "fatal")}`);
  }
});

test("large real-world fixture renders the fig content", async ({ page }) => {
  const diagnostics: DiagnosticEntry[] = [];
  const recorder = makeRecorder(diagnostics);
  page.on("console", recorder.onConsole);
  page.on("pageerror", recorder.onPageError);

  await page.goto("/?fixture=large");

  await waitForReady(page).catch(async (err: unknown) => {
    throw new Error(`webview never posted webview/ready\n${await dumpState(page, diagnostics, "ready timeout")}\n${err}`);
  });

  // The fig viewer must reach the three-pane workspace — proves the
  // webview progressed past `createFigDocumentContext`. The old header
  // assertion (filename in `.higma-fig-toolbar__filename`) was retired
  // when the header itself moved to the VS Code status bar.
  await expect(page.locator(".higma-fig-workspace")).toBeVisible({ timeout: 30_000 });

  // The renderer emits an SVG with `data-fig-family-page-renderer=""`
  // and at least one child node when the page actually painted. The
  // "empty" branch emits a `<g data-fig-family-page-renderer-empty>`
  // sibling instead, so we assert against the populated form.
  const renderedSvg = page.locator("svg[data-fig-family-page-renderer]");
  await expect(renderedSvg).toBeVisible({ timeout: 30_000 });
  const childCount = await renderedSvg.evaluate((el) => el.children.length);
  if (childCount === 0) {
    throw new Error(
      `fig SVG rendered with zero children\n${await dumpState(page, diagnostics, "empty render")}`,
    );
  }

  // No render-time exception is acceptable. A fatal here means the
  // viewer crashed silently in production too.
  const handle = (await page.evaluate(() => window.__higmaE2E)) as E2EHandle | undefined;
  const webviewErrors = (handle?.captured ?? []).filter(
    (m) => m.type === "webview/log" && (m as { level?: unknown }).level === "error",
  );
  const pageErrors = diagnostics.filter((d) => d.kind === "pageerror");
  if (pageErrors.length + webviewErrors.length > 0) {
    throw new Error(
      `large fixture produced fatal diagnostics\n${await dumpState(page, diagnostics, "fatal")}`,
    );
  }
});

test("garbage bytes surface the error UI and forward webview/log", async ({ page }) => {
  const diagnostics: DiagnosticEntry[] = [];
  const recorder = makeRecorder(diagnostics);
  page.on("console", recorder.onConsole);
  page.on("pageerror", recorder.onPageError);

  await page.goto("/?fixture=garbage");

  await waitForReady(page).catch(async (err: unknown) => {
    throw new Error(`webview never posted webview/ready\n${await dumpState(page, diagnostics, "ready timeout")}\n${err}`);
  });

  // The webview's own error UI must appear — proof that the React error
  // path is wired (not a silent blank screen).
  const errorStatus = page.locator(".higma-fig-status--error");
  await expect(errorStatus).toBeVisible({ timeout: 15_000 });

  // The host channel must receive a webview/log error — proof the
  // extension host can observe the failure end-to-end.
  await page.waitForFunction(
    () => {
      const captured = window.__higmaE2E?.captured ?? [];
      return captured.some(
        (m) => m.type === "webview/log" && (m as { level?: unknown }).level === "error",
      );
    },
    undefined,
    { timeout: 15_000 },
  );
});

declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- ambient Window augmentation
  interface Window {
    __higmaE2E?: E2EHandle;
  }
}
