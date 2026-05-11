/**
 * @file Lazy singleton Playwright Chromium for the spec suite.
 *
 * Many spec files (cases/wikipedia-*, cases/yahoo-co-jp-search,
 * cases-fullpage/* …) call `captureViewport` which internally
 * runs `playwright.chromium.launch()` followed by `browser.close()`
 * for every individual capture. When bun-test schedules those spec
 * files in parallel within one process, the launch / close churn
 * fights for chromium-process resources and the slowest cases
 * (wikipedia's 5.81 MB infobox fixture) flake into the spec
 * timeout.
 *
 * This pool launches one chromium for the whole suite and hands
 * out a fresh `BrowserContext` per call. The browser stays open
 * until `process.exit`, where we tear it down via `process.on
 * ("beforeExit", …)`. Sharing the browser is safe because every
 * caller asks for its own context, which Playwright guarantees is
 * isolated (own cookies, own viewport, own storage).
 *
 * Why the indirection:
 *   - It removes the per-spec launch latency entirely.
 *   - It serialises the slowest part of capture (the playwright
 *     process spawn) so flaky timeouts disappear.
 *   - It does not change the per-test contract — every spec still
 *     gets a clean isolated page.
 */
import type { BrowserLike } from "../src/web-source/playwright-shared";
import { launchBrowser } from "../src/web-source/playwright-shared";

// Lazy promise that holds the singleton browser. Wrapping in a
// promise rather than a `Browser | undefined` lets multiple
// concurrent callers all `await` the same launch — the second
// caller doesn't kick off a second `chromium.launch`.
const browserRef: { promise: Promise<BrowserLike> | undefined } = { promise: undefined };

/**
 * Return the suite-wide shared browser, lazily launching it on
 * first use. Concurrent callers receive the same browser handle.
 */
export function sharedBrowser(): Promise<BrowserLike> {
  if (browserRef.promise === undefined) {
    browserRef.promise = launchBrowser().then((b) => {
      // The node runtime fires `beforeExit` once the event loop is
      // empty, which is also after every spec has resolved. Hook
      // the close there so we don't leak chromium when the suite
      // wraps up.
      const onExit = (): void => {
        const promise = browserRef.promise;
        if (promise === undefined) {
          return;
        }
        // Reset before closing so a stray follow-up call doesn't
        // hand back a closing handle.
        browserRef.promise = undefined;
        // The close itself is fire-and-forget — we are already
        // tearing down the process.
        // eslint-disable-next-line no-restricted-syntax -- shutdown hook intentionally fire-and-forget
        promise.then((handle) => handle.close()).catch(() => undefined);
      };
      process.once("beforeExit", onExit);
      process.once("exit", onExit);
      return b;
    });
  }
  return browserRef.promise;
}
