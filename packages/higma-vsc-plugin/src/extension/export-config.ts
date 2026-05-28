/**
 * @file Resolve the `higma.figViewer.exportDirectory` setting into a
 * concrete `vscode.Uri` and a user-facing label.
 *
 * Resolution rules (precedence top-down):
 *   1. Empty / unset           — write next to the opened `.fig`.
 *   2. `~` or `~/...`          — expanded against `os.homedir()`.
 *   3. Absolute fsPath         — used verbatim.
 *   4. Relative path           — resolved against the workspace folder
 *                                that contains the document, falling
 *                                back to the document's parent dir
 *                                when the file is not inside a
 *                                workspace.
 *
 * The label policy is shared with the InspectPanel so the host owns
 * formatting end-to-end and the webview never has to reason about
 * `$HOME` or workspace-folder geometry.
 */

import * as path from "node:path";
import * as os from "node:os";
import * as vscode from "vscode";
import type { ViewerConfig } from "../shared/protocol";

export const HIGMA_FIG_VIEWER_CONFIG_NAMESPACE = "higma.figViewer";
export const HIGMA_FIG_VIEWER_EXPORT_DIRECTORY_KEY = "exportDirectory";

/** Resolve the configured export directory for `documentUri`. */
export function resolveExportDirectory(documentUri: vscode.Uri): vscode.Uri {
  const setting = vscode.workspace
    .getConfiguration(HIGMA_FIG_VIEWER_CONFIG_NAMESPACE, documentUri)
    .get<string>(HIGMA_FIG_VIEWER_EXPORT_DIRECTORY_KEY);
  const trimmed = (setting ?? "").trim();
  const documentDir = vscode.Uri.joinPath(documentUri, "..");
  if (trimmed.length === 0) {
    return documentDir;
  }
  if (trimmed === "~" || trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    const remainder = trimmed === "~" ? "" : trimmed.slice(2);
    const expanded = remainder.length === 0 ? os.homedir() : path.join(os.homedir(), remainder);
    return vscode.Uri.file(expanded);
  }
  if (path.isAbsolute(trimmed)) {
    return vscode.Uri.file(trimmed);
  }
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
  const base = workspaceFolder ? workspaceFolder.uri.fsPath : documentDir.fsPath;
  return vscode.Uri.file(path.resolve(base, trimmed));
}

/**
 * Compose a human-friendly label for `directoryUri`:
 *   - inside a workspace folder → `<folder-name>/<relative>`
 *   - inside `$HOME` (and not workspace) → `~/<relative>`
 *   - otherwise → absolute `fsPath`
 */
export function formatExportDirectoryLabel(directoryUri: vscode.Uri): string {
  const workspaceLabel = workspaceRelativeLabel(directoryUri);
  if (workspaceLabel !== null) {
    return workspaceLabel;
  }
  const home = os.homedir();
  const fsPath = directoryUri.fsPath;
  if (home.length > 0 && (fsPath === home || fsPath.startsWith(home + path.sep))) {
    const tail = fsPath.slice(home.length);
    return tail.length === 0 ? "~" : `~${tail}`;
  }
  return fsPath;
}

function workspaceRelativeLabel(uri: vscode.Uri): string | null {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) {
    return null;
  }
  const folderPath = folder.uri.fsPath;
  if (uri.fsPath === folderPath) {
    return folder.name;
  }
  if (!uri.fsPath.startsWith(folderPath + path.sep)) {
    return null;
  }
  // Normalise to forward slashes — webview-side display uses URL-style
  // paths so this stays consistent on Windows.
  return `${folder.name}/${uri.fsPath.slice(folderPath.length + 1).replace(/\\/g, "/")}`;
}

/** Resolve both fields of `ViewerConfig` for the given document. */
export function resolveViewerConfig(documentUri: vscode.Uri): ViewerConfig {
  const directoryUri = resolveExportDirectory(documentUri);
  return {
    exportDirectoryFsPath: directoryUri.fsPath,
    exportDirectoryLabel: formatExportDirectoryLabel(directoryUri),
  };
}
