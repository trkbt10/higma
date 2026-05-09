import { writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { waitForReady } from "../../web-to-fig/src/web-source/wait-for-ready";

async function main(): Promise<void> {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded", timeout: 30000 });
    await waitForReady(page, { timeoutMs: 8000 });
    // Check if the body-level sprite svg is being marked visible by isVisible.
    const spriteSvgInfo = await page.evaluate(() => {
      const svgs = Array.from(document.querySelectorAll("svg"));
      const out: { tag: string; rect: { w: number; h: number }; childCount: number; pos: string; opacity: string; visibility: string; display: string }[] = [];
      for (const s of svgs) {
        const r = s.getBoundingClientRect();
        const cs = getComputedStyle(s);
        // include any svg whose width or height crosses 200px
        if (r.width > 200 || r.height > 200) {
          out.push({
            tag: s.tagName,
            rect: { w: r.width, h: r.height },
            childCount: s.children.length,
            pos: cs.position,
            opacity: cs.opacity,
            visibility: cs.visibility,
            display: cs.display,
          });
        }
      }
      return out;
    });
    void spriteSvgInfo;
    const data = await page.evaluate(() => {
      function describeAncestors(el: Element) {
        const out: Array<Record<string, unknown>> = [];
        let cur: Element | null = el;
        while (cur && cur !== document.documentElement) {
          const r = cur.getBoundingClientRect();
          const cs = getComputedStyle(cur);
          out.push({
            tag: cur.tagName.toLowerCase(),
            id: (cur as HTMLElement).id || undefined,
            cls: typeof cur.className === "string" ? cur.className.slice(0, 35) : "",
            rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
            position: cs.position,
            display: cs.display,
            top: cs.top,
            visibility: cs.visibility,
          });
          cur = cur.parentElement;
        }
        return out.reverse();
      }
      // The labels we are looking for: ホーム, ショート, 登録チャンネル, マイページ
      const nodes = Array.from(document.querySelectorAll("a, button, ytd-mini-guide-entry-renderer, [aria-label]"));
      const home = nodes.find((n) => /(?:^|[\s>])(?:ホーム|Home)\s*$/i.test((n.textContent ?? "").trim()))
        ?? nodes.find((n) => /Home/.test((n as HTMLElement).getAttribute("aria-label") ?? ""));
      const shorts = nodes.find((n) => /ショート|Shorts/.test((n.textContent ?? "")))
        ?? nodes.find((n) => /Shorts/.test((n as HTMLElement).getAttribute("aria-label") ?? ""));
      const subs = nodes.find((n) => /登録チャンネル|Subscriptions/.test((n.textContent ?? "")));
      const mypage = nodes.find((n) => /マイページ|You/.test((n.textContent ?? "")));
      return {
        homeChain: home ? describeAncestors(home) : null,
        shortsChain: shorts ? describeAncestors(shorts) : null,
        subsChain: subs ? describeAncestors(subs) : null,
        mypageChain: mypage ? describeAncestors(mypage) : null,
      };
    });
    writeFileSync("/tmp/yt-sidebar.json", JSON.stringify({ ...data, spriteSvgs: spriteSvgInfo }, null, 2));
  } finally {
    await browser.close();
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
