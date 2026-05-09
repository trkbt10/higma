/**
 * Run fig-to-web on the existing youtube.fig bundle, then look at
 * what HTML/CSS gets emitted for the ytd-mini-guide-renderer subtree.
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "@higma-tools/fig-to-web";

async function main(): Promise<void> {
  const work = await mkdtemp(join(tmpdir(), "yt-fig-to-web-"));
  try {
    await runCli({
      input: "<REPO>/.tmp-output/youtube-fidelity/youtube.fig",
      out: work,
      page: "Web Capture",
      mode: "all",
      serve: false,
      port: 0,
      bundle: true,
      debugAttrs: false,
    }, { info: () => undefined, error: (m) => process.stderr.write(`${m}\n`) });
    // Find the desktop standalone tsx + html
    const all: string[] = [];
    async function walk(dir: string): Promise<void> {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else all.push(p);
      }
    }
    await walk(work);
    const tsx = all.find((p) => p.endsWith(".tsx") && p.includes("desktop") && !p.endsWith("standalone.tsx"));
    const html = all.find((p) => p.endsWith("index.html") && p.includes("desktop"));
    if (!tsx || !html) {
      console.error("missing desktop standalone files; have:", all);
      return;
    }
    const tsxText = await readFile(tsx, "utf8");
    const htmlText = await readFile(html, "utf8");
    // Extract the chunk that mentions "ytd-mini-guide-renderer".
    // The element name might survive only as a class hint, or the
    // emitter could have collapsed. Find the bounding box that fixed
    // creates: width:72 + height:744 + position:absolute.
    const idx = tsxText.indexOf("ytd-mini-guide-renderer");
    const snippet = idx >= 0 ? tsxText.slice(Math.max(0, idx - 200), idx + 6000) : `(name not found, len=${tsxText.length})\n${tsxText.slice(0, 4000)}`;
    await writeFile("/tmp/yt-html-tsx.snippet.txt", snippet);
    await writeFile("/tmp/yt-html-htmlhead.txt", htmlText.slice(0, 3000));
    process.stdout.write(`tsx=${tsx}\nhtml=${html}\n`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
