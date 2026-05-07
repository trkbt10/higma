/**
 * @file VS Code extension entry point for the Higma `.fig` viewer.
 *
 * Wires up the custom editor provider that renders `.fig` files inside
 * a webview hosted in the editor area.
 */

import * as vscode from "vscode";
import { registerFigViewer } from "./fig-viewer-provider";
import { getHigmaOutputChannel } from "./output-channel";

/**
 * Activates the extension.
 *
 * Triggered lazily by `onCustomEditor:higma.figViewer` when VS Code
 * opens a `.fig` file. Registers the custom readonly editor and
 * surfaces a brief status-bar pill so the user can confirm activation
 * even with the Output panel collapsed.
 */
export function activate(context: vscode.ExtensionContext): void {
  const channel = getHigmaOutputChannel();
  context.subscriptions.push(channel);
  channel.appendLine(
    `[activate] higma-vsc-plugin loaded from ${context.extensionUri.fsPath} — registering customEditor higma.figViewer`,
  );
  vscode.window.setStatusBarMessage("$(check) Higma Fig Viewer activated", 4000);
  context.subscriptions.push(registerFigViewer(context));
}

/**
 * Deactivates the extension.
 *
 * No-op: every long-lived resource is registered through the
 * `context.subscriptions` array and is disposed automatically.
 */
export function deactivate(): void {
  return;
}
