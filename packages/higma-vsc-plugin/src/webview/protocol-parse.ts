/**
 * @file Validate `MessageEvent.data` against `ExtensionToWebviewMessage`.
 *
 * The webview entry, FigViewer, and download.ts all attach `message`
 * listeners — they each care about a different subset of the
 * protocol, but they share this validator so the union stays in one
 * place and a new wire shape only needs one update.
 *
 * The validator deliberately returns `undefined` for unrecognised
 * payloads rather than throwing: a runtime that mixes our messages
 * with VS Code internals (or arbitrary `MessageEvent`s during e2e)
 * must not blow up here.
 */

import type {
  ExtensionToWebviewMessage,
  ExportResultOutcome,
  ViewerConfig,
  ZoomCommand,
} from "../shared/protocol";

/** Best-effort projection of `MessageEvent.data` onto the typed protocol union. */
export function parseExtensionMessage(raw: unknown): ExtensionToWebviewMessage | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const candidate = raw as { type?: unknown };
  if (candidate.type === "fig/loaded") {
    return parseLoadedMessage(raw);
  }
  if (candidate.type === "fig/error") {
    return parseFigErrorMessage(raw);
  }
  if (candidate.type === "viewer/config") {
    return parseViewerConfigMessage(raw);
  }
  if (candidate.type === "viewer/zoomCommand") {
    return parseViewerZoomCommandMessage(raw);
  }
  if (candidate.type === "viewer/exportResult") {
    return parseViewerExportResultMessage(raw);
  }
  return undefined;
}

function parseLoadedMessage(raw: unknown): ExtensionToWebviewMessage | undefined {
  const message = raw as { uri?: unknown; fileName?: unknown; bytesBase64?: unknown };
  if (
    typeof message.uri !== "string" ||
    typeof message.fileName !== "string" ||
    typeof message.bytesBase64 !== "string"
  ) {
    return undefined;
  }
  return {
    type: "fig/loaded",
    uri: message.uri,
    fileName: message.fileName,
    bytesBase64: message.bytesBase64,
  };
}

function parseFigErrorMessage(raw: unknown): ExtensionToWebviewMessage | undefined {
  const message = raw as { uri?: unknown; message?: unknown };
  if (typeof message.uri !== "string" || typeof message.message !== "string") {
    return undefined;
  }
  return { type: "fig/error", uri: message.uri, message: message.message };
}

function parseViewerConfigMessage(raw: unknown): ExtensionToWebviewMessage | undefined {
  const message = raw as { config?: unknown };
  const config = parseViewerConfig(message.config);
  if (!config) {
    return undefined;
  }
  return { type: "viewer/config", config };
}

function parseViewerConfig(raw: unknown): ViewerConfig | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const c = raw as { exportDirectoryFsPath?: unknown; exportDirectoryLabel?: unknown };
  if (typeof c.exportDirectoryFsPath !== "string" || typeof c.exportDirectoryLabel !== "string") {
    return undefined;
  }
  return {
    exportDirectoryFsPath: c.exportDirectoryFsPath,
    exportDirectoryLabel: c.exportDirectoryLabel,
  };
}

const ZOOM_COMMANDS: readonly ZoomCommand[] = ["in", "out", "fit", "reset"];

function parseViewerZoomCommandMessage(raw: unknown): ExtensionToWebviewMessage | undefined {
  const message = raw as { command?: unknown };
  if (typeof message.command !== "string") {
    return undefined;
  }
  const command = message.command as ZoomCommand;
  if (!ZOOM_COMMANDS.includes(command)) {
    return undefined;
  }
  return { type: "viewer/zoomCommand", command };
}

function parseViewerExportResultMessage(raw: unknown): ExtensionToWebviewMessage | undefined {
  const message = raw as {
    requestId?: unknown;
    fileName?: unknown;
    outcome?: unknown;
  };
  if (typeof message.requestId !== "string" || typeof message.fileName !== "string") {
    return undefined;
  }
  const outcome = parseExportResultOutcome(message.outcome);
  if (!outcome) {
    return undefined;
  }
  return {
    type: "viewer/exportResult",
    requestId: message.requestId,
    fileName: message.fileName,
    outcome,
  };
}

function parseExportResultOutcome(raw: unknown): ExportResultOutcome | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const o = raw as { kind?: unknown; savedFsPath?: unknown; message?: unknown };
  if (o.kind === "saved" && typeof o.savedFsPath === "string") {
    return { kind: "saved", savedFsPath: o.savedFsPath };
  }
  if (o.kind === "error" && typeof o.message === "string") {
    return { kind: "error", message: o.message };
  }
  return undefined;
}
