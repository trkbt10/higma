/**
 * @file Lazy accessor for the extension's dedicated `Higma Fig Viewer`
 * Output panel channel.
 *
 * Lives in its own module (rather than `index.ts`) so the editor
 * provider can import it without forming an import cycle with the
 * extension entry — `index.ts` already imports the provider.
 */

import * as vscode from "vscode";

const channelRef: { current: vscode.OutputChannel | null } = { current: null };

/**
 * Returns the singleton `Higma Fig Viewer` Output channel, creating
 * it on first access. The channel is shared by `activate`, the
 * editor provider, and the webview log forwarder so a developer can
 * pin one panel and see the full lifecycle.
 */
export function getHigmaOutputChannel(): vscode.OutputChannel {
  if (channelRef.current) {
    return channelRef.current;
  }
  const created = vscode.window.createOutputChannel("Higma Fig Viewer");
  channelRef.current = created;
  return created;
}
