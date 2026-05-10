/**
 * @file Argv parser for the `web-to-fig-extract` CLI.
 *
 * Supports two extraction sources:
 *
 *   1. URL launch (default):
 *      web-to-fig-extract <url> <selector> <out.html>
 *
 *      Spawns a headless Chromium, navigates to <url>, and extracts.
 *
 *   2. CDP connect (Electron / running Chrome):
 *      web-to-fig-extract --cdp <endpoint> <selector> <out.html>
 *
 *      Connects to an existing Chromium / Electron instance running
 *      with `--remote-debugging-port=<n>` (Slack, VSCode, Discord,
 *      …) and extracts from the *current* DOM of the matched page.
 *      Use `--page-match <substr>` to disambiguate when the target
 *      has multiple windows / tabs.
 */
import { CliUsageError } from "./args";

export type ExtractCliOptions = UrlExtractCliOptions | CdpExtractCliOptions;

type CommonCliOptions = {
  readonly selector: string;
  readonly outputPath: string;
  readonly title: string | undefined;
  readonly waitForSelector: string | undefined;
  readonly waitForSelectorTimeoutMs: number | undefined;
};

export type UrlExtractCliOptions = CommonCliOptions & {
  readonly mode: "url";
  readonly url: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly devicePixelRatio: number;
  readonly waitUntil: "load" | "domcontentloaded" | "networkidle";
  readonly timeoutMs: number | undefined;
};

export type CdpExtractCliOptions = CommonCliOptions & {
  readonly mode: "cdp";
  readonly cdpEndpoint: string;
  readonly pageMatch: string | undefined;
  readonly sourceLabel: string | undefined;
};

const USAGE = `Usage:
  web-to-fig-extract <url> <selector> <out.html> [common flags] [url flags]
  web-to-fig-extract --cdp <endpoint> <selector> <out.html> [common flags] [--page-match SUBSTR] [--source-label URL]

Common flags:
  --title T
  --wait-for-selector SEL
  --wait-for-selector-timeout MS

URL-mode flags:
  --viewport WxH (default 1280x800)
  --dpr N
  --wait load|domcontentloaded|networkidle (default domcontentloaded)
  --timeout MS`;

type ParseState = {
  readonly positional: readonly string[];
  readonly viewport: { readonly width: number; readonly height: number };
  readonly devicePixelRatio: number;
  readonly waitUntil: UrlExtractCliOptions["waitUntil"];
  readonly timeoutMs: number | undefined;
  readonly title: string | undefined;
  readonly waitForSelector: string | undefined;
  readonly waitForSelectorTimeoutMs: number | undefined;
  readonly cdpEndpoint: string | undefined;
  readonly pageMatch: string | undefined;
  readonly sourceLabel: string | undefined;
  readonly skip: number;
};

const INITIAL_STATE: ParseState = {
  positional: [],
  viewport: { width: 1280, height: 800 },
  devicePixelRatio: 1,
  waitUntil: "domcontentloaded",
  timeoutMs: undefined,
  title: undefined,
  waitForSelector: undefined,
  waitForSelectorTimeoutMs: undefined,
  cdpEndpoint: undefined,
  pageMatch: undefined,
  sourceLabel: undefined,
  skip: 0,
};

/** Parse argv into ExtractCliOptions. Throws `CliUsageError` on malformed input. */
export function parseExtractArgs(argv: readonly string[]): ExtractCliOptions {
  if (argv.length < 2) {
    throw new CliUsageError(USAGE);
  }
  const final = argv.reduce<ParseState>((state, token, index) => {
    if (state.skip > 0) {
      return { ...state, skip: state.skip - 1 };
    }
    return applyToken(state, token, argv[index + 1]);
  }, INITIAL_STATE);

  if (final.cdpEndpoint !== undefined) {
    return finaliseCdp(final);
  }
  return finaliseUrl(final);
}

function finaliseUrl(state: ParseState): UrlExtractCliOptions {
  if (state.positional.length !== 3) {
    throw new CliUsageError("URL mode expects three positional arguments: <url> <selector> <out.html>");
  }
  return {
    mode: "url",
    url: state.positional[0]!,
    selector: state.positional[1]!,
    outputPath: state.positional[2]!,
    viewport: state.viewport,
    devicePixelRatio: state.devicePixelRatio,
    waitUntil: state.waitUntil,
    timeoutMs: state.timeoutMs,
    title: state.title,
    waitForSelector: state.waitForSelector,
    waitForSelectorTimeoutMs: state.waitForSelectorTimeoutMs,
  };
}

function finaliseCdp(state: ParseState): CdpExtractCliOptions {
  if (state.positional.length !== 2) {
    throw new CliUsageError("CDP mode expects two positional arguments: <selector> <out.html>");
  }
  return {
    mode: "cdp",
    cdpEndpoint: state.cdpEndpoint!,
    selector: state.positional[0]!,
    outputPath: state.positional[1]!,
    pageMatch: state.pageMatch,
    sourceLabel: state.sourceLabel,
    title: state.title,
    waitForSelector: state.waitForSelector,
    waitForSelectorTimeoutMs: state.waitForSelectorTimeoutMs,
  };
}

function applyToken(state: ParseState, token: string, value: string | undefined): ParseState {
  if (!token.startsWith("--")) {
    return { ...state, positional: [...state.positional, token] };
  }
  switch (token) {
    case "--viewport":
      return { ...state, viewport: parseViewport(value), skip: 1 };
    case "--dpr":
      return { ...state, devicePixelRatio: parseDpr(value), skip: 1 };
    case "--wait":
      return { ...state, waitUntil: parseWait(value), skip: 1 };
    case "--timeout":
      return { ...state, timeoutMs: parseTimeout(value), skip: 1 };
    case "--title":
      return { ...state, title: parseStringFlag(value, "--title"), skip: 1 };
    case "--wait-for-selector":
      return { ...state, waitForSelector: parseStringFlag(value, "--wait-for-selector"), skip: 1 };
    case "--wait-for-selector-timeout":
      return { ...state, waitForSelectorTimeoutMs: parseTimeout(value), skip: 1 };
    case "--cdp":
      return { ...state, cdpEndpoint: parseStringFlag(value, "--cdp"), skip: 1 };
    case "--page-match":
      return { ...state, pageMatch: parseStringFlag(value, "--page-match"), skip: 1 };
    case "--source-label":
      return { ...state, sourceLabel: parseStringFlag(value, "--source-label"), skip: 1 };
    default:
      throw new CliUsageError(`Unknown flag "${token}"`);
  }
}

function parseViewport(value: string | undefined): { readonly width: number; readonly height: number } {
  if (!value) {
    throw new CliUsageError("--viewport requires a WxH value");
  }
  const [w, h] = value.split("x");
  if (!w || !h) {
    throw new CliUsageError(`--viewport must be WxH, got "${value}"`);
  }
  return { width: parseInt(w, 10), height: parseInt(h, 10) };
}

function parseDpr(value: string | undefined): number {
  if (!value) {
    throw new CliUsageError("--dpr requires a number");
  }
  return parseFloat(value);
}

function parseWait(value: string | undefined): UrlExtractCliOptions["waitUntil"] {
  if (value !== "load" && value !== "domcontentloaded" && value !== "networkidle") {
    throw new CliUsageError(`--wait must be load|domcontentloaded|networkidle, got "${value}"`);
  }
  return value;
}

function parseTimeout(value: string | undefined): number {
  if (!value) {
    throw new CliUsageError("--timeout requires a number");
  }
  return parseInt(value, 10);
}

function parseStringFlag(value: string | undefined, flag: string): string {
  if (!value) {
    throw new CliUsageError(`${flag} requires a value`);
  }
  return value;
}
