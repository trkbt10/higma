/**
 * @file `web-to-fig-extract` runtime — drives `extractElement` and
 * writes the resulting standalone HTML document to disk.
 *
 * Lives outside the bin so callers (test harnesses, scripted batch
 * extractors) can invoke the same end-to-end behaviour
 * programmatically.
 */
import { writeFile } from "node:fs/promises";
import { extractElement, type ExtractOptions } from "../web-source";
import type { CdpExtractCliOptions, ExtractCliOptions, UrlExtractCliOptions } from "./extract-args";

/** End-to-end extract: drive Playwright → write HTML → log a one-line summary. */
export async function runExtractCli(options: ExtractCliOptions): Promise<void> {
  const extractOptions = toExtractOptions(options);
  const result = await extractElement(extractOptions);
  await writeFile(options.outputPath, result.html, "utf8");
  process.stdout.write(
    `Extracted "${options.selector}" from ${result.source}\n`
    + `  → ${options.outputPath} `
    + `(${result.html.length} chars, `
    + `${result.inlinedResources} resources, `
    + `${result.inlinedFontFaces} font-faces inlined)\n`,
  );
}

function toExtractOptions(cli: ExtractCliOptions): ExtractOptions {
  if (cli.mode === "cdp") {
    return cdpToOptions(cli);
  }
  return urlToOptions(cli);
}

function urlToOptions(cli: UrlExtractCliOptions): ExtractOptions {
  return {
    source: "url",
    url: cli.url,
    selector: cli.selector,
    viewport: cli.viewport,
    devicePixelRatio: cli.devicePixelRatio,
    waitUntil: cli.waitUntil,
    timeoutMs: cli.timeoutMs,
    title: cli.title,
    waitForSelector: cli.waitForSelector,
    waitForSelectorTimeoutMs: cli.waitForSelectorTimeoutMs,
  };
}

function cdpToOptions(cli: CdpExtractCliOptions): ExtractOptions {
  return {
    source: "cdp",
    endpoint: cli.cdpEndpoint,
    selector: cli.selector,
    pageMatch: cli.pageMatch,
    sourceLabel: cli.sourceLabel,
    title: cli.title,
    waitForSelector: cli.waitForSelector,
    waitForSelectorTimeoutMs: cli.waitForSelectorTimeoutMs,
  };
}
