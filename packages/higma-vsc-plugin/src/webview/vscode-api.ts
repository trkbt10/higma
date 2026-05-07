/**
 * @file Thin wrapper around the global `acquireVsCodeApi` injected by VS
 * Code into webview contexts.
 *
 * The host injects the API exactly once per webview instance — calling
 * `acquireVsCodeApi` a second time throws. This module memoises the
 * single instance so the webview UI can request it freely from any
 * component without tracking the call site.
 */

import type { WebviewToExtensionMessage } from "../shared/protocol";

type VsCodeApi = {
  postMessage(message: unknown): void;
  setState(state: unknown): void;
  getState(): unknown;
};

declare global {
  var acquireVsCodeApi: (() => VsCodeApi) | undefined;
}

/**
 * Inline bootstrap script in the host HTML may have already called
 * `acquireVsCodeApi()` and stashed the result on `window`. Reading
 * through this lookup (rather than `window.__higmaVsCodeApi`) avoids
 * needing a global `Window` augmentation, which the workspace lint
 * rule discourages.
 */
/**
 * Type guard validating an unknown value as the VS Code webview API.
 * Used to read the synthetic `window.__higmaVsCodeApi` slot the inline
 * bootstrap script may have populated, without augmenting the global
 * `Window` type.
 */
function isVsCodeApi(value: unknown): value is VsCodeApi {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const api = value as { postMessage?: unknown; setState?: unknown; getState?: unknown };
  return (
    typeof api.postMessage === "function" &&
    typeof api.setState === "function" &&
    typeof api.getState === "function"
  );
}

function readPreAcquiredApi(): VsCodeApi | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  const candidate: unknown = Reflect.get(window, "__higmaVsCodeApi");
  return isVsCodeApi(candidate) ? candidate : undefined;
}

const apiHolder: { value: VsCodeApi | null } = { value: null };

/**
 * Returns the cached VS Code webview API instance.
 *
 * Throws when called outside a VS Code webview context, because the
 * injected `acquireVsCodeApi` is the only way to obtain a working
 * channel back to the extension host.
 */
export function getVsCodeApi(): VsCodeApi {
  if (apiHolder.value) {
    return apiHolder.value;
  }
  const preAcquired = readPreAcquiredApi();
  if (preAcquired) {
    apiHolder.value = preAcquired;
    return preAcquired;
  }
  const acquire = globalThis.acquireVsCodeApi;
  if (typeof acquire !== "function") {
    throw new Error("acquireVsCodeApi is not available; this script must run inside a VS Code webview.");
  }
  const api = acquire();
  apiHolder.value = api;
  return api;
}

/**
 * Sends a typed message to the extension host.
 */
export function postToExtension(message: WebviewToExtensionMessage): void {
  getVsCodeApi().postMessage(message);
}
