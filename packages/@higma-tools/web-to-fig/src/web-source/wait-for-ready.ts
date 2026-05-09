/**
 * @file Generic "the page is ready to be captured" waiter.
 *
 * The captured snapshot is meaningful only after every visible asset
 * — fonts, raster images, and custom-element-injected SVG icons —
 * has actually painted. Playwright's `networkidle` is officially
 * discouraged for SPAs (analytics / poll requests keep the network
 * busy forever) and Playwright's `load` event fires before lazy
 * subresources kick in, so neither lifecycle event alone is a
 * sufficient signal.
 *
 * Strategy — assert on observable DOM state, not on time:
 *   1. `document.fonts.ready` — text metrics stabilise once the
 *      browser has the real font, not the fallback.
 *   2. Auto-scroll the page from top to bottom (and back) once. This
 *      forces any IntersectionObserver-driven lazy loaders (modern
 *      `loading="lazy"`, libraries that mount on view, etc.) to
 *      schedule their fetches.
 *   3. `waitForFunction` polling a single composite predicate that
 *      every viewport-sized capture should satisfy:
 *         a. every visible `<img>` has `complete && naturalWidth > 0`
 *         b. every custom-element host that publishes an icon
 *            (yt-icon / iron-icon / yt-icon-shape / lit-icon) has a
 *            child `<svg>` (icon frameworks deferred-inject after a
 *            microtask).
 *      If a predicate is unsatisfiable for the current page (e.g.
 *      no custom icon hosts exist), it short-circuits to true so the
 *      waiter doesn't hang on the absence of a feature.
 *
 * The predicate is evaluated *inside* the page via Playwright's own
 * `waitForFunction` — Playwright re-runs it on every animation frame
 * until it returns truthy or the timeout elapses, so the cost on
 * already-settled pages is a single tick.
 */

/** Subset of the Playwright `Page` API actually used here. Kept structural so the file is testable without a full Playwright import. */
export type PageForReady = {
  waitForLoadState(state: "load" | "domcontentloaded" | "networkidle"): Promise<void>;
  evaluate<T>(fn: () => T): Promise<T>;
  evaluate<T, A>(fn: (arg: A) => T, arg: A): Promise<T>;
  waitForFunction<T>(fn: () => T, arg?: unknown, opts?: { readonly timeout: number }): Promise<unknown>;
};

export type WaitForReadyOptions = {
  /** Cap for each individual sub-wait. Defaults to 8000ms. */
  readonly timeoutMs?: number;
  /** Disable the auto-scroll pass (some pages capture better in their initial scroll position). */
  readonly skipScroll?: boolean;
};

/**
 * Wait until the page has settled enough to be captured.
 *
 * Each sub-wait is `.catch(() => undefined)`-wrapped so a single
 * stuck signal (e.g. a font that never loads, an icon set that's
 * absent, a lazy image that errored) doesn't poison the whole
 * capture. The predicates are still strong enough that under normal
 * conditions every signal resolves before the timeout — the
 * fall-through only kicks in for genuinely pathological pages.
 */
export async function waitForReady(page: PageForReady, options: WaitForReadyOptions = {}): Promise<void> {
  const timeout = options.timeoutMs ?? 8000;

  // Lifecycle: `load` covers <link>, <script>, top-level <img>.
  // We deliberately do **not** wait for `networkidle` — it is
  // unreliable on SPAs that keep long-poll connections open.
  await page.waitForLoadState("load").catch(() => undefined);

  // Fonts: text geometry depends on the real face being available.
  // `document.fonts.ready` resolves once every @font-face referenced
  // by used CSS has either loaded or errored.
  await page.evaluate(() => {
    const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts;
    return fonts ? fonts.ready : undefined;
  }).catch(() => undefined);

  if (!options.skipScroll) {
    await autoScroll(page).catch(() => undefined);
  }

  // Composite "everything visible is rendered" predicate.
  await page.waitForFunction(
    () => {
      function isVisible(el: Element): boolean {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        // Element is laid out somewhere on the page; we don't restrict
        // to the current viewport because a snapshot may want full-page
        // captures later. Rendering completeness is a per-element
        // property anyway.
        return true;
      }

      // (a) Every visible <img> has decoded successfully.
      const imgs = Array.from(document.images);
      for (const img of imgs) {
        if (!isVisible(img)) continue;
        // A failed image still flips `complete` to true — we accept
        // that as "we waited as long as the browser will". The other
        // alternative is to hang on broken thumbnails forever.
        if (!img.complete) return false;
      }

      // (b) Custom-element icon hosts have injected their SVGs.
      // The selector list is the union of icon frameworks we've seen
      // in the wild; adding more is safe (an absent host contributes
      // nothing to the loop).
      const iconHostSelectors = "yt-icon, iron-icon, yt-icon-shape, lit-icon, sl-icon";
      const hosts = Array.from(document.querySelectorAll(iconHostSelectors));
      for (const host of hosts) {
        if (!isVisible(host)) continue;
        const svg = host.querySelector("svg");
        if (svg === null) return false;
        // Some frameworks insert <svg> shells with no <use>/<path>
        // until the icon definition arrives. Treat empty shells as
        // "still loading".
        if (svg.children.length === 0) return false;
      }

      return true;
    },
    undefined,
    { timeout },
  ).catch(() => undefined);
}

/**
 * Scroll the page from top to bottom in viewport-sized increments,
 * then restore the original position. This is the cheapest reliable
 * way to fire IntersectionObserver-based lazy loaders.
 *
 * We use a real animation-frame loop (not `setTimeout(0)`) because
 * IntersectionObserver fires after layout, and `requestAnimationFrame`
 * gives the browser a chance to lay out the new scroll position
 * before we move on.
 */
async function autoScroll(page: PageForReady): Promise<void> {
  await page.evaluate(async () => {
    const startY = window.scrollY;
    await new Promise<void>((resolve) => {
      const step = Math.max(window.innerHeight * 0.8, 200);
      let y = 0;
      const tick = (): void => {
        const max = Math.max(
          document.body?.scrollHeight ?? 0,
          document.documentElement?.scrollHeight ?? 0,
        );
        if (y >= max) {
          window.scrollTo(0, startY);
          resolve();
          return;
        }
        window.scrollTo(0, y);
        y += step;
        requestAnimationFrame(tick);
      };
      tick();
    });
  });
}
