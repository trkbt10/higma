/**
 * @file E2E harness that hosts the same webview entry the VS Code
 * extension loads, with `acquireVsCodeApi` stubbed and a fixture `.fig`
 * injected via the same `fig/loaded` message the extension would post.
 *
 * The harness is intentionally a faithful host: it does not import any
 * of the webview's modules synchronously — the stub must be installed
 * on `globalThis` before the webview's first `getVsCodeApi()` call, so
 * `webview/index.tsx` is loaded only after `acquireVsCodeApi` exists.
 *
 * Selecting a scenario:
 *   ?fixture=small   (default) — small shapes.fig
 *   ?fixture=large   — 7MB sample-file.fig (real-world Figma export)
 *   ?fixture=garbage — non-fig bytes, exercises the error path
 */

import smallFixtureUrl from "./fixtures/sample.fig?url";
import largeFixtureUrl from "../../../@higma-document-io/fig/samples/sample-file.fig?url";

type CapturedMessage = { readonly type: string; readonly [key: string]: unknown };

type E2EState = "init" | "ready-received" | "loaded-sent" | "error";

type Scenario = "small" | "large" | "garbage";

type E2EHandle = {
  state: E2EState;
  scenario: Scenario;
  readonly captured: CapturedMessage[];
  fixtureUri: string;
  fixtureName: string;
  readonly readyPromise: Promise<void>;
  resolveReady?: () => void;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- ambient Window augmentation
  interface Window {
    __higmaE2E?: E2EHandle;
    acquireVsCodeApi?: () => {
      postMessage(message: unknown): void;
      setState(state: unknown): void;
      getState(): unknown;
    };
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  const out: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    out.push(String.fromCharCode(...chunk));
  }
  return btoa(out.join(""));
}

function postFigLoaded(params: {
  readonly fixtureUri: string;
  readonly fixtureName: string;
  readonly bytesBase64: string;
}): void {
  const message = {
    type: "fig/loaded",
    uri: params.fixtureUri,
    fileName: params.fixtureName,
    bytesBase64: params.bytesBase64,
  };
  window.dispatchEvent(new MessageEvent("message", { data: message }));
}

function installVsCodeApiStub(handle: E2EHandle): void {
  let acquired = false;
  window.acquireVsCodeApi = () => {
    if (acquired) {
      throw new Error("acquireVsCodeApi may only be called once per webview");
    }
    acquired = true;
    return {
      postMessage(raw: unknown) {
        if (typeof raw !== "object" || raw === null) {
          return;
        }
        const message = raw as CapturedMessage;
        handle.captured.push(message);
        if (message.type === "webview/ready") {
          handle.state = "ready-received";
          handle.resolveReady?.();
        }
      },
      setState() {
        return;
      },
      getState() {
        return undefined;
      },
    };
  };
}

function pickScenario(): Scenario {
  const param = new URLSearchParams(window.location.search).get("fixture");
  if (param === "large" || param === "garbage") {
    return param;
  }
  return "small";
}

function resolveFixtureName(scenario: Scenario): string {
  switch (scenario) {
    case "small":
      return "sample.fig";
    case "large":
      return "sample-file.fig";
    case "garbage":
      return "garbage.fig";
  }
}

function resolveFixtureUrl(scenario: Scenario): string | null {
  switch (scenario) {
    case "small":
      return smallFixtureUrl;
    case "large":
      return largeFixtureUrl;
    case "garbage":
      return null;
  }
}

/**
 * Resolve a captured fixture URL to an absolute URI; fall back to a
 * `synthetic://` placeholder when the scenario doesn't ship one.
 */
function resolveFixtureUri(fixtureUrl: string | undefined, fixtureName: string): string {
  if (fixtureUrl) { return new URL(fixtureUrl, window.location.origin).toString(); }
  return `synthetic://${fixtureName}`;
}

/**
 * Load the fixture bytes for the current scenario. With a real URL we
 * `fetch` it and base64-encode the bytes; otherwise we fall back to a
 * synthetic 64-byte garbage payload so the bootstrap exercises the
 * "no fixture" branch without a network round-trip.
 */
async function fetchFixtureBytesBase64(fixtureUrl: string | undefined): Promise<string> {
  if (!fixtureUrl) { return buildGarbageBytesBase64(); }
  const res = await fetch(fixtureUrl);
  if (!res.ok) {
    throw new Error(`failed to fetch fixture: ${res.status}`);
  }
  return arrayBufferToBase64(await res.arrayBuffer());
}

function buildGarbageBytesBase64(): string {
  const bytes = new Uint8Array(64);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = i & 0xff;
  }
  return arrayBufferToBase64(bytes.buffer);
}

const scenario = pickScenario();
const fixtureName = resolveFixtureName(scenario);
const fixtureUrl = resolveFixtureUrl(scenario);
const fixtureUri = resolveFixtureUri(fixtureUrl, fixtureName);

const handle: E2EHandle = {
  state: "init",
  scenario,
  captured: [],
  fixtureUri,
  fixtureName,
  readyPromise: Promise.resolve(),
};
handle.readyPromise = new Promise<void>((resolve) => {
  handle.resolveReady = resolve;
});
window.__higmaE2E = handle;

installVsCodeApiStub(handle);

async function bootstrap(): Promise<void> {
  const bytesPromise: Promise<string> = fetchFixtureBytesBase64(fixtureUrl);

  await import("../../src/webview/index");

  await handle.readyPromise;
  const bytesBase64 = await bytesPromise;
  postFigLoaded({
    fixtureUri: handle.fixtureUri,
    fixtureName: handle.fixtureName,
    bytesBase64,
  });
  handle.state = "loaded-sent";
}

bootstrap().catch((error: unknown) => {
  handle.state = "error";
  console.error("[higma-e2e harness]", error);
});
