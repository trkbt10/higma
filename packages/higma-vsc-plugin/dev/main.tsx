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

import smallFixtureUrl from "../spec/e2e/fixtures/sample.fig?url";
import largeFixtureUrl from "../../@higma-document-io/fig/samples/sample-file.fig?url";

type DevTheme = "dark" | "light";
type DevFixture = "small" | "large" | "garbage";

type VsCodeStubApi = {
  postMessage(message: unknown): void;
  setState(state: unknown): void;
  getState(): unknown;
};

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
        const message = raw as { type?: unknown; level?: unknown; message?: unknown };
        if (message.type === "webview/ready") {
          setStatus("ready");
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
