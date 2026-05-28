/**
 * @file Cross-cutting host-side state for active Higma fig viewers.
 *
 * A `ViewerSession` is created once per resolved custom editor. The
 * manager:
 *
 *   - Owns the VS Code status-bar item that mirrors the focused
 *     viewer's zoom percentage, so the in-webview header that used to
 *     hold the zoom buttons can be removed without losing the
 *     information (mirroring VS Code's image-preview status readout).
 *   - Routes `higma.figViewer.zoomIn / Out / Reset / Fit` commands to
 *     the focused viewer's webview so users can bind keyboard
 *     shortcuts and they reach exactly the document they are looking
 *     at.
 *   - Handles `viewer/exportFile` by writing bytes via
 *     `workspace.fs.writeFile`, with the target directory derived
 *     from the `higma.figViewer.exportDirectory` setting.
 *   - Handles `viewer/chooseExportDirectory` with the native folder
 *     picker and persists the selection through the configuration
 *     system; a single `onDidChangeConfiguration` listener pushes the
 *     new `viewer/config` payload to every open viewer.
 */

import * as vscode from "vscode";
import type {
  ExtensionToWebviewMessage,
  ExportResultOutcome,
  ViewerConfig,
  WebviewToExtensionMessage,
  ZoomCommand,
} from "../shared/protocol";
import {
  HIGMA_FIG_VIEWER_CONFIG_NAMESPACE,
  HIGMA_FIG_VIEWER_EXPORT_DIRECTORY_KEY,
  resolveViewerConfig,
} from "./export-config";
import { getHigmaOutputChannel } from "./output-channel";

export type ViewerSession = {
  readonly panel: vscode.WebviewPanel;
  readonly documentUri: vscode.Uri;
  exportDirectory: vscode.Uri;
  exportDirectoryLabel: string;
  zoomPercent: number;
  fitActive: boolean;
  /** True once the webview has emitted at least one `viewer/state`. */
  hasState: boolean;
  /** Per-session disposables (view-state listener etc.). */
  readonly disposables: vscode.Disposable[];
};

export type SessionManager = {
  /** Construct + register a session; provider calls this per `resolveCustomEditor`. */
  createSession(panel: vscode.WebviewPanel, documentUri: vscode.Uri): ViewerSession;
  /** Provider calls this from `panel.onDidDispose`. */
  releaseSession(session: ViewerSession): void;
  /** Send the current `viewer/config` to a session — invoke after `webview/ready`. */
  pushInitialConfig(session: ViewerSession): void;
  /** Returns true if the manager owned the message (the provider can stop processing). */
  handleWebviewMessage(session: ViewerSession, message: WebviewToExtensionMessage): boolean;
  dispose(): void;
};

const NO_VIEWER_MESSAGE = "No Higma Fig Viewer is focused.";

/**
 * Construct the session manager singleton — owns the status-bar item,
 * the `higma.figViewer.*` commands, and the configuration listener
 * that pushes `viewer/config` updates to every live session.
 */
export function createSessionManager(): SessionManager {
  const sessions = new Set<ViewerSession>();
  const activeRef: { value: ViewerSession | null } = { value: null };

  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.name = "Higma Fig Viewer Zoom";
  // Clicking the item itself resets the zoom — matches the behaviour
  // of the percentage button in the removed in-webview toolbar. The
  // richer menu (Zoom in / out, Fit, Reset) is delivered through the
  // hover popover on `statusItem.tooltip` below, which appears at the
  // item's screen position rather than the top-anchored QuickPick
  // dropdown that the earlier revision used.
  statusItem.command = "higma.figViewer.zoomReset";

  // Cached MarkdownString tooltip — rebuilt only when the Fit flag
  // changes so we don't allocate a fresh markdown object every zoom
  // tick.
  const tooltipState: { fitActive: boolean | null; value: vscode.MarkdownString } = {
    fitActive: null,
    value: new vscode.MarkdownString("", true),
  };

  const buildTooltip = (fitActive: boolean): vscode.MarkdownString => {
    if (tooltipState.fitActive === fitActive) {
      return tooltipState.value;
    }
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportThemeIcons = true;
    md.appendMarkdown(`**Higma Fig Viewer — Zoom**\n\n`);
    md.appendMarkdown(
      `[$(zoom-out) Zoom out](command:higma.figViewer.zoomOut "Zoom out") `,
    );
    md.appendMarkdown(
      `[$(zoom-in) Zoom in](command:higma.figViewer.zoomIn "Zoom in")\n\n`,
    );
    const fitMarker = fitActive ? "$(check) " : "";
    md.appendMarkdown(
      `[${fitMarker}Fit to window](command:higma.figViewer.fit "Fit the document into the visible stage") `,
    );
    md.appendMarkdown(
      `[Reset to 100%](command:higma.figViewer.zoomReset "Reset zoom to 100%")`,
    );
    tooltipState.fitActive = fitActive;
    tooltipState.value = md;
    return md;
  };

  const refreshStatus = (): void => {
    const session = activeRef.value;
    if (!session || !session.hasState) {
      statusItem.hide();
      return;
    }
    const fitSuffix = session.fitActive ? " (Fit)" : "";
    statusItem.text = `$(zoom-in) ${session.zoomPercent}%${fitSuffix}`;
    statusItem.tooltip = buildTooltip(session.fitActive);
    statusItem.show();
  };

  const setActive = (session: ViewerSession | null): void => {
    activeRef.value = session;
    refreshStatus();
  };

  // Replace the prohibited `if/else if` chain with a tiny helper so
  // the active session updates in one direction at a time.
  const syncActiveOnViewStateChange = (session: ViewerSession): void => {
    if (session.panel.active) {
      setActive(session);
      return;
    }
    if (activeRef.value === session) {
      setActive(null);
    }
  };

  const postToSession = (session: ViewerSession, message: ExtensionToWebviewMessage): void => {
    void session.panel.webview.postMessage(message);
  };

  const dispatchZoom = (command: ZoomCommand): void => {
    const session = activeRef.value;
    if (!session) {
      void vscode.window.showInformationMessage(NO_VIEWER_MESSAGE);
      return;
    }
    postToSession(session, { type: "viewer/zoomCommand", command });
  };

  const pickConfigScope = (session: ViewerSession): vscode.ConfigurationTarget => {
    const inspect = vscode.workspace
      .getConfiguration(HIGMA_FIG_VIEWER_CONFIG_NAMESPACE, session.documentUri)
      .inspect<string>(HIGMA_FIG_VIEWER_EXPORT_DIRECTORY_KEY);
    if (inspect?.workspaceFolderValue !== undefined) {
      return vscode.ConfigurationTarget.WorkspaceFolder;
    }
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      return vscode.ConfigurationTarget.Workspace;
    }
    return vscode.ConfigurationTarget.Global;
  };

  const promptChooseExportDirectory = async (session: ViewerSession): Promise<void> => {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      defaultUri: session.exportDirectory,
      openLabel: "Set as Higma export folder",
      title: "Choose Higma Fig Viewer export folder",
    });
    const target = picked && picked.length > 0 ? picked[0] : undefined;
    if (!target) {
      return;
    }
    await vscode.workspace
      .getConfiguration(HIGMA_FIG_VIEWER_CONFIG_NAMESPACE, session.documentUri)
      .update(
        HIGMA_FIG_VIEWER_EXPORT_DIRECTORY_KEY,
        target.fsPath,
        pickConfigScope(session),
      );
    // The configuration listener below pushes the new viewer/config
    // to every session — including this one — so the InspectPanel
    // refreshes without a separate code path.
  };

  const sendExportResult = (
    session: ViewerSession,
    requestId: string,
    fileName: string,
    outcome: ExportResultOutcome,
  ): void => {
    postToSession(session, { type: "viewer/exportResult", requestId, fileName, outcome });
  };

  const writeExportFile = async (params: {
    readonly session: ViewerSession;
    readonly requestId: string;
    readonly fileName: string;
    readonly bytesBase64: string;
  }): Promise<void> => {
    const { session, requestId, fileName, bytesBase64 } = params;
    const channel = getHigmaOutputChannel();
    try {
      const bytes = Buffer.from(bytesBase64, "base64");
      await vscode.workspace.fs.createDirectory(session.exportDirectory);
      const target = vscode.Uri.joinPath(session.exportDirectory, fileName);
      await vscode.workspace.fs.writeFile(target, bytes);
      channel.appendLine(
        `[viewer/exportFile] wrote ${target.fsPath} (${bytes.byteLength} bytes)`,
      );
      sendExportResult(session, requestId, fileName, {
        kind: "saved",
        savedFsPath: target.fsPath,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      channel.appendLine(`[viewer/exportFile] failed for ${fileName}: ${message}`);
      sendExportResult(session, requestId, fileName, { kind: "error", message });
    }
  };

  const refreshSessionConfig = (session: ViewerSession): void => {
    const next = resolveViewerConfig(session.documentUri);
    session.exportDirectory = vscode.Uri.file(next.exportDirectoryFsPath);
    session.exportDirectoryLabel = next.exportDirectoryLabel;
    postToSession(session, { type: "viewer/config", config: next });
  };

  const onConfigChange = vscode.workspace.onDidChangeConfiguration((event) => {
    if (!event.affectsConfiguration(HIGMA_FIG_VIEWER_CONFIG_NAMESPACE)) {
      return;
    }
    for (const session of sessions) {
      refreshSessionConfig(session);
    }
  });

  const commandDisposables: vscode.Disposable[] = [
    vscode.commands.registerCommand("higma.figViewer.zoomIn", () => dispatchZoom("in")),
    vscode.commands.registerCommand("higma.figViewer.zoomOut", () => dispatchZoom("out")),
    vscode.commands.registerCommand("higma.figViewer.zoomReset", () => dispatchZoom("reset")),
    vscode.commands.registerCommand("higma.figViewer.fit", () => dispatchZoom("fit")),
    vscode.commands.registerCommand("higma.figViewer.chooseExportDirectory", () => {
      const session = activeRef.value;
      if (!session) {
        void vscode.window.showInformationMessage(NO_VIEWER_MESSAGE);
        return;
      }
      void promptChooseExportDirectory(session);
    }),
  ];

  return {
    createSession(panel, documentUri) {
      const config: ViewerConfig = resolveViewerConfig(documentUri);
      const session: ViewerSession = {
        panel,
        documentUri,
        exportDirectory: vscode.Uri.file(config.exportDirectoryFsPath),
        exportDirectoryLabel: config.exportDirectoryLabel,
        zoomPercent: 100,
        fitActive: true,
        hasState: false,
        disposables: [],
      };
      sessions.add(session);
      session.disposables.push(
        panel.onDidChangeViewState(() => {
          syncActiveOnViewStateChange(session);
        }),
      );
      if (panel.active) {
        setActive(session);
      }
      return session;
    },
    releaseSession(session) {
      for (const d of session.disposables) {
        d.dispose();
      }
      session.disposables.length = 0;
      sessions.delete(session);
      if (activeRef.value === session) {
        setActive(null);
      }
    },
    pushInitialConfig(session) {
      const config: ViewerConfig = {
        exportDirectoryFsPath: session.exportDirectory.fsPath,
        exportDirectoryLabel: session.exportDirectoryLabel,
      };
      postToSession(session, { type: "viewer/config", config });
    },
    handleWebviewMessage(session, message) {
      switch (message.type) {
        case "viewer/state":
          session.zoomPercent = message.zoomPercent;
          session.fitActive = message.fitActive;
          session.hasState = true;
          if (activeRef.value === session) {
            refreshStatus();
          }
          return true;
        case "viewer/exportFile":
          void writeExportFile({
            session,
            requestId: message.requestId,
            fileName: message.fileName,
            bytesBase64: message.bytesBase64,
          });
          return true;
        case "viewer/chooseExportDirectory":
          void promptChooseExportDirectory(session);
          return true;
        default:
          return false;
      }
    },
    dispose() {
      onConfigChange.dispose();
      for (const d of commandDisposables) {
        d.dispose();
      }
      statusItem.dispose();
      sessions.clear();
      activeRef.value = null;
    },
  };
}
