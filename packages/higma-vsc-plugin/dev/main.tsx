/**
 * @file Browser playground host for the higma-vsc-plugin webview.
 *
 * Mirrors the e2e harness (`spec/e2e/harness.tsx`) but is shaped for
 * interactive use:
 *
 *   1. Installs an `acquireVsCodeApi` stub on `window` before importing
 *      `src/webview/index`. The webview posts `webview/ready`
 *      synchronously at module evaluation, so the stub must exist
 *      *before* the import — otherwise the eager post throws.
 *
 *   2. Defaults to loading `spec/e2e/fixtures/sample.fig` so opening
 *      the playground URL produces a rendered viewer immediately.
 *
 *   3. Provides a dev toolbar (built from the static markup in
 *      `index.html`) for swapping fixtures, opening arbitrary `.fig`
 *      files via picker or drag-and-drop, and toggling the simulated
 *      VS Code theme.
 *
 * The toolbar talks to the webview the same way the real extension
 * does: by dispatching a `MessageEvent` carrying a `fig/loaded`
 * payload. There is no other privileged channel — the webview cannot
 * tell it is running in a browser.
 */

// Vite handles stylesheet imports with the right MIME type and HMR.
// A `<link rel="stylesheet">` in `dev/index.html` would 404 / fall back
// to text/html for paths outside Vite's root, which silently breaks the
// layout instead of failing loud.
import "../src/webview/styles.css";

import smallFixtureUrl from "../spec/e2e/fixtures/sample.fig?url";
import largeFixtureUrl from "../../@higma-document-io/fig/samples/sample-file.fig?url";
import { triggerBlobDownload } from "../src/webview/export/download";

type DevTheme = "dark" | "light";
type DevFixture = "small" | "large" | "garbage";

type VsCodeStubApi = {
  postMessage(message: unknown): void;
  setState(state: unknown): void;
  getState(): unknown;
};

const DEV_EXPORT_DIRECTORY_LABEL = "~/Downloads (dev:ui fallback)";

function dispatchToWebview(payload: unknown): void {
  window.dispatchEvent(new MessageEvent("message", { data: payload }));
}

function decodeBase64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Handle a `viewer/exportFile` request from the webview by triggering
 * an anchor download (the closest thing the browser playground has to
 * `workspace.fs.writeFile`) and replying with `viewer/exportResult`.
 *
 * Without this the InspectPanel would hang on its export Promise
 * forever inside `dev:ui`, because the webview always goes through the
 * host channel since the production code dropped the
 * "no-host → anchor download" branch.
 */
function handleViewerExportFile(payload: {
  readonly requestId: unknown;
  readonly fileName: unknown;
  readonly mimeType: unknown;
  readonly bytesBase64: unknown;
}): void {
  if (
    typeof payload.requestId !== "string" ||
    typeof payload.fileName !== "string" ||
    typeof payload.mimeType !== "string" ||
    typeof payload.bytesBase64 !== "string"
  ) {
    console.warn("[dev:ui] dropped malformed viewer/exportFile", payload);
    return;
  }
  try {
    const bytes = decodeBase64ToBytes(payload.bytesBase64);
    const blob = new Blob([bytes], { type: payload.mimeType });
    triggerBlobDownload(blob, payload.fileName);
    dispatchToWebview({
      type: "viewer/exportResult",
      requestId: payload.requestId,
      fileName: payload.fileName,
      outcome: {
        kind: "saved",
        savedFsPath: `~/Downloads/${payload.fileName}`,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    dispatchToWebview({
      type: "viewer/exportResult",
      requestId: payload.requestId,
      fileName: payload.fileName,
      outcome: { kind: "error", message },
    });
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

function installVsCodeApiStub(setStatus: (text: string) => void): void {
  const acquired = { value: false };
  const stubFactory = (): VsCodeStubApi => {
    if (acquired.value) {
      throw new Error("acquireVsCodeApi may only be called once per webview");
    }
    acquired.value = true;
    return {
      postMessage(raw: unknown) {
        if (typeof raw !== "object" || raw === null) {
          return;
        }
        const message = raw as {
          type?: unknown;
          level?: unknown;
          message?: unknown;
          requestId?: unknown;
          fileName?: unknown;
          mimeType?: unknown;
          bytesBase64?: unknown;
        };
        if (message.type === "webview/ready") {
          setStatus("ready");
          // Push the synthetic `viewer/config` the real extension host
          // would deliver after `webview/ready`, so the InspectPanel's
          // "Output folder" row shows a meaningful label inside the
          // dev playground instead of "…".
          dispatchToWebview({
            type: "viewer/config",
            config: {
              exportDirectoryFsPath: DEV_EXPORT_DIRECTORY_LABEL,
              exportDirectoryLabel: DEV_EXPORT_DIRECTORY_LABEL,
            },
          });
          return;
        }
        if (message.type === "webview/log") {
          // Surface webview-side logs in the host's devtools so the
          // failure modes that the extension's Output channel would
          // catch are visible here too.
          const level = message.level === "error" ? "error" : message.level === "warn" ? "warn" : "info";
          const text = typeof message.message === "string" ? message.message : JSON.stringify(message.message);
          if (level === "error") {
            console.error("[webview/log]", text);
          } else if (level === "warn") {
            console.warn("[webview/log]", text);
          } else {
            console.info("[webview/log]", text);
          }
          return;
        }
        if (message.type === "viewer/exportFile") {
          handleViewerExportFile({
            requestId: message.requestId,
            fileName: message.fileName,
            mimeType: message.mimeType,
            bytesBase64: message.bytesBase64,
          });
          return;
        }
        if (message.type === "viewer/chooseExportDirectory") {
          // The browser has no folder picker that maps to
          // `workspace.fs`. Inform the developer instead of silently
          // dropping the request — full coverage requires `bun run dev`.
          // eslint-disable-next-line no-alert -- dev playground only
          window.alert("Choose-folder is not supported in dev:ui. Launch via `bun run dev` to exercise the real folder picker.");
          return;
        }
        // viewer/state arrives every zoom tick — quietly ignored here;
        // the production host would forward it to the status bar.
      },
      setState() {
        return;
      },
      getState() {
        return undefined;
      },
    };
  };
  // `vscode-api.ts` reads `globalThis.acquireVsCodeApi` (declared
  // there as a global var). Assigning through `globalThis` matches the
  // existing declaration and avoids augmenting `Window`.
  globalThis.acquireVsCodeApi = stubFactory;
}

function postFigLoaded(params: { readonly fileName: string; readonly bytes: Uint8Array }): void {
  const message = {
    type: "fig/loaded",
    uri: `dev://${params.fileName}`,
    fileName: params.fileName,
    bytesBase64: arrayBufferToBase64(params.bytes.buffer.slice(
      params.bytes.byteOffset,
      params.bytes.byteOffset + params.bytes.byteLength,
    )),
  };
  window.dispatchEvent(new MessageEvent("message", { data: message }));
}

async function loadFromUrl(params: { readonly url: string; readonly fileName: string }): Promise<void> {
  const res = await fetch(params.url);
  if (!res.ok) {
    throw new Error(`failed to fetch ${params.url}: HTTP ${res.status}`);
  }
  const buffer = await res.arrayBuffer();
  postFigLoaded({ fileName: params.fileName, bytes: new Uint8Array(buffer) });
}

async function loadFromFile(file: File): Promise<void> {
  const buffer = await file.arrayBuffer();
  postFigLoaded({ fileName: file.name, bytes: new Uint8Array(buffer) });
}

function buildGarbageBytes(): Uint8Array {
  const bytes = new Uint8Array(64);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = i & 0xff;
  }
  return bytes;
}

function fixtureSpec(name: DevFixture): { readonly url: string | null; readonly fileName: string } {
  switch (name) {
    case "small":
      return { url: smallFixtureUrl, fileName: "sample.fig" };
    case "large":
      return { url: largeFixtureUrl, fileName: "sample-file.fig" };
    case "garbage":
      return { url: null, fileName: "garbage.fig" };
  }
}

function pickInitialFixture(): DevFixture {
  const param = new URLSearchParams(window.location.search).get("fixture");
  if (param === "large" || param === "garbage" || param === "small") {
    return param;
  }
  return "small";
}

function pickInitialTheme(): DevTheme {
  const param = new URLSearchParams(window.location.search).get("theme");
  if (param === "light") {
    return "light";
  }
  return "dark";
}

function applyTheme(theme: DevTheme): void {
  document.documentElement.dataset.higmaTheme = theme;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-action="theme"]')) {
    button.setAttribute("aria-pressed", String(button.dataset.value === theme));
  }
}

function highlightFixture(name: DevFixture | null): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-action="fixture"]')) {
    button.setAttribute("aria-pressed", String(name !== null && button.dataset.value === name));
  }
}

function setCurrentLabel(label: string): void {
  const el = document.getElementById("higma-dev-current");
  if (el) {
    el.textContent = label;
  }
}

function setStatus(text: string): void {
  const el = document.getElementById("higma-dev-status");
  if (el) {
    el.textContent = text;
  }
}

async function loadFixture(name: DevFixture): Promise<void> {
  const spec = fixtureSpec(name);
  highlightFixture(name);
  setCurrentLabel(spec.fileName);
  setStatus(`loading ${spec.fileName}…`);
  try {
    if (spec.url === null) {
      postFigLoaded({ fileName: spec.fileName, bytes: buildGarbageBytes() });
    } else {
      await loadFromUrl({ url: spec.url, fileName: spec.fileName });
    }
    setStatus(`loaded ${spec.fileName}`);
  } catch (error: unknown) {
    setStatus(`failed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

async function loadCustomFile(file: File): Promise<void> {
  highlightFixture(null);
  setCurrentLabel(file.name);
  setStatus(`loading ${file.name}…`);
  try {
    await loadFromFile(file);
    setStatus(`loaded ${file.name}`);
  } catch (error: unknown) {
    setStatus(`failed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

function wireToolbar(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-action="theme"]')) {
    button.addEventListener("click", () => {
      const value = button.dataset.value;
      if (value === "dark" || value === "light") {
        applyTheme(value);
      }
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-action="fixture"]')) {
    button.addEventListener("click", () => {
      const value = button.dataset.value;
      if (value === "small" || value === "large" || value === "garbage") {
        void loadFixture(value);
      }
    });
  }

  const fileInput = document.getElementById("higma-dev-file-input") as HTMLInputElement | null;
  const openButton = document.querySelector<HTMLButtonElement>('[data-action="open-file"]');
  if (fileInput && openButton) {
    openButton.addEventListener("click", () => {
      fileInput.click();
    });
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (file) {
        void loadCustomFile(file);
        // Reset so picking the same file again still fires `change`.
        fileInput.value = "";
      }
    });
  }
}

function wireDragAndDrop(): void {
  const stage = document.getElementById("higma-dev-stage");
  const overlay = document.getElementById("higma-dev-drop-overlay");
  if (!stage || !overlay) {
    return;
  }
  // Suppress the browser's default drag-handling at the document
  // level so dropping outside the stage does not navigate away.
  for (const event of ["dragenter", "dragover", "dragleave", "drop"]) {
    document.addEventListener(event, (e) => {
      e.preventDefault();
    });
  }
  stage.addEventListener("dragenter", () => {
    overlay.dataset.active = "true";
  });
  stage.addEventListener("dragover", (event) => {
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
    overlay.dataset.active = "true";
  });
  stage.addEventListener("dragleave", (event) => {
    if (event.target === stage || event.target === overlay) {
      overlay.dataset.active = "false";
    }
  });
  stage.addEventListener("drop", (event) => {
    overlay.dataset.active = "false";
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      void loadCustomFile(file);
    }
  });
}

async function bootstrap(): Promise<void> {
  applyTheme(pickInitialTheme());
  installVsCodeApiStub(setStatus);
  wireToolbar();
  wireDragAndDrop();

  // The webview module is imported *after* the stub is in place.
  // It will post `webview/ready` during evaluation, which the stub
  // captures and forwards to `setStatus("ready")`. A static import
  // would hoist to module init, run before `installVsCodeApiStub`,
  // and the eager `webview/ready` post inside the webview entry
  // would throw — so the dynamic import is structural here.
  // eslint-disable-next-line no-restricted-syntax -- ordering requirement explained above
  await import("../src/webview/index");

  await loadFixture(pickInitialFixture());
}

bootstrap().catch((error: unknown) => {
  console.error("[higma-vsc-plugin/dev]", error);
  setStatus(`bootstrap failed: ${error instanceof Error ? error.message : String(error)}`);
});
