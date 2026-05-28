/**
 * @file Deliver rendered export bytes through the extension host.
 *
 * Earlier revisions of the viewer downloaded blobs directly via an
 * anchor click and let the browser drop the file in the user's
 * default Downloads folder. The plugin now exposes a configurable
 * `higma.figViewer.exportDirectory` setting, so every export must go
 * through the extension host so it can write to the configured folder
 * via `workspace.fs.writeFile`.
 *
 * The `dev:ui` playground simulates the host channel inside its
 * `acquireVsCodeApi` stub: it consumes `viewer/exportFile`, triggers
 * a local anchor download for parity with production UX, and posts
 * back a synthetic `viewer/exportResult` so this module's promise
 * resolves the same way as it does inside VS Code.
 */

import type { ExportResultOutcome } from "../../shared/protocol";
import { parseExtensionMessage } from "../protocol-parse";
import { postToExtension } from "../vscode-api";

type PendingExport = {
  readonly resolve: (outcome: ExportResultOutcome) => void;
};

const pendingExports = new Map<string, PendingExport>();
const listenerState: { installed: boolean } = { installed: false };

function installResultListener(): void {
  if (listenerState.installed || typeof window === "undefined") {
    return;
  }
  listenerState.installed = true;
  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    const parsed = parseExtensionMessage(event.data);
    if (!parsed || parsed.type !== "viewer/exportResult") {
      return;
    }
    const pending = pendingExports.get(parsed.requestId);
    if (!pending) {
      return;
    }
    pendingExports.delete(parsed.requestId);
    pending.resolve(parsed.outcome);
  });
}

function generateRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for unusual runtimes (older harnesses, restricted iframes).
  // Cryptographic strength is unnecessary; only uniqueness within the
  // outstanding `pendingExports` map matters.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function stripDataUrlPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

/**
 * Encode a `Blob` as a base64 string via `FileReader.readAsDataURL`.
 *
 * `Blob.arrayBuffer()` would let us encode chunk-by-chunk in JS, but
 * webview-grade browsers handle the data-URL path natively and avoid
 * round-tripping multi-megabyte payloads through `String.fromCharCode`
 * loops. The result of `readAsDataURL` looks like
 * `data:image/png;base64,iVBORw0…`; we slice the prefix off.
 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("FileReader produced a non-string result"));
        return;
      }
      resolve(stripDataUrlPrefix(result));
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Send `blob` to the host for persistence and wait for the result.
 *
 * The host writes to `higma.figViewer.exportDirectory`; the caller
 * receives `{ kind: "saved", savedFsPath }` on success, or
 * `{ kind: "error", message }` if `workspace.fs.writeFile` failed.
 */
export async function deliverExportBlob(blob: Blob, fileName: string): Promise<ExportResultOutcome> {
  installResultListener();
  const bytesBase64 = await blobToBase64(blob);
  const requestId = generateRequestId();
  return new Promise<ExportResultOutcome>((resolve) => {
    pendingExports.set(requestId, { resolve });
    postToExtension({
      type: "viewer/exportFile",
      requestId,
      fileName,
      mimeType: blob.type,
      bytesBase64,
    });
  });
}

/**
 * Anchor-click download. Retained as an exported helper so the dev:ui
 * playground can simulate VS Code's `workspace.fs.writeFile` by writing
 * to the browser's download channel.
 */
export function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke after the click microtask drains so Safari/Firefox have
  // time to start the download. 5s is generous and not user-visible.
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

/** Build a filesystem-safe export filename from layer name, suffix, and extension. */
export function buildExportFileName(params: {
  readonly baseName: string;
  readonly suffix: string;
  readonly extension: "png" | "jpg" | "svg";
}): string {
  const safeBase = sanitiseFileName(params.baseName) || "export";
  const safeSuffix = sanitiseFileName(params.suffix);
  const join = safeSuffix.length > 0 ? `${safeBase}${safeSuffix}` : safeBase;
  return `${join}.${params.extension}`;
}

function sanitiseFileName(value: string): string {
  // Strip path separators and characters Windows reserves for paths.
  // Whitespace is collapsed to a single space rather than removed so
  // a suffix like " @1x" still produces "Rectangle 1 @1x.png" instead
  // of "Rectangle1@1x.png".
  return value
    .replace(/[/\\:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
