/**
 * @file Custom readonly editor provider that hosts a webview for a
 * single `.fig` document.
 *
 * Responsibilities:
 *   1. Adopt the `vscode.CustomDocument` lifecycle (open / resolve / dispose).
 *   2. Read the `.fig` bytes from disk and forward them to the webview as
 *      a base64 payload.
 *   3. Configure the webview HTML with a strict CSP and the JS/CSS asset
 *      URIs derived from the extension's bundled `dist/` directory.
 *
 * The provider is a `CustomReadonlyEditorProvider` because the viewer
 * does not yet support edits — saving / undo are intentionally absent.
 */

import * as vscode from "vscode";
import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from "../shared/protocol";
import { getHigmaOutputChannel } from "./output-channel";

const VIEW_TYPE = "higma.figViewer";

type FigDocument = vscode.CustomDocument;

function createFigDocument(uri: vscode.Uri): FigDocument {
  return {
    uri,
    dispose() {
      return;
    },
  };
}

/**
 * Encodes a byte buffer to a base64 string without exceeding the V8
 * argument list limit on large inputs.
 *
 * `Buffer.from(uint8).toString('base64')` is fine in Node, but the named
 * operation keeps the call site explicit about the encoding.
 */
function encodeBytesAsBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function buildNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const out: string[] = [];
  for (let i = 0; i < 32; i += 1) {
    out.push(chars.charAt(Math.floor(Math.random() * chars.length)));
  }
  return out.join("");
}

function buildWebviewHtml(params: {
  readonly webview: vscode.Webview;
  readonly extensionUri: vscode.Uri;
  readonly nonce: string;
}): string {
  const { webview, extensionUri, nonce } = params;
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "webview.js"));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "webview.css"));
  const cspSource = webview.cspSource;
  // `'unsafe-eval'` is required because the webview bundle pulls in
  // `opentype.js` (via `@higma-document-renderers/fig`) which compiles
  // glyph parsers at runtime with `new Function(...)`. Without it, the
  // very first text-rendering call throws a CSP violation and the
  // entire webview script silently fails to reach `webview/ready`.
  const csp = [
    "default-src 'none'",
    `img-src ${cspSource} data: blob:`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `font-src ${cspSource}`,
    `script-src 'nonce-${nonce}' 'unsafe-eval'`,
  ].join("; ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri.toString()}" />
  <title>Higma Fig Viewer</title>
  <style>
    .higma-fig-bootstrap {
      display: flex; align-items: center; justify-content: center;
      height: 100%; padding: 24px;
      font-family: var(--vscode-font-family);
      color: var(--vscode-descriptionForeground, var(--vscode-foreground));
    }
    .higma-fig-bootstrap__inner { text-align: center; }
    .higma-fig-bootstrap code {
      display: block; margin-top: 8px; font-size: 11px; opacity: 0.6;
      max-width: 720px; word-break: break-all; white-space: pre-wrap;
    }
  </style>
</head>
<body>
  <div id="higma-fig-root">
    <div class="higma-fig-bootstrap">
      <div class="higma-fig-bootstrap__inner">
        <div>Loading webview script…</div>
        <code>${scriptUri.toString()}</code>
      </div>
    </div>
  </div>
  <script nonce="${nonce}">
    // Diagnostic: inline (non-module) script. If THIS posts but the
    // module script below does not, the failure is specific to module
    // loading (404 on src, CSP, MIME). If even this does not post, the
    // webview is dropping all scripts (CSP / sandbox issue).
    (function() {
      try {
        var api = acquireVsCodeApi();
        window.__higmaVsCodeApi = api;
        api.postMessage({ type: "webview/log", level: "info", message: "[bootstrap] inline script ran" });
        window.addEventListener("error", function (e) {
          api.postMessage({ type: "webview/log", level: "error", message: "[window.error] " + (e.message || String(e.error)) });
        });
        setTimeout(function () {
          if (!window.__higmaModuleRan) {
            api.postMessage({ type: "webview/log", level: "error", message: "[bootstrap] module script never executed within 3s" });
          }
        }, 3000);
      } catch (err) {
        document.getElementById("higma-fig-root").textContent = "inline script crashed: " + (err && err.message ? err.message : String(err));
      }
    })();
  </script>
  <script type="module" nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
}

async function postFigBytes(params: {
  readonly webview: vscode.Webview;
  readonly uri: vscode.Uri;
}): Promise<void> {
  const { webview, uri } = params;
  const channel = getHigmaOutputChannel();
  const fileName = uri.path.split("/").slice(-1)[0] ?? "untitled.fig";
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    channel.appendLine(`[ext→webview] sending fig/loaded fileName=${fileName} bytes=${bytes.byteLength}`);
    const message: ExtensionToWebviewMessage = {
      type: "fig/loaded",
      uri: uri.toString(),
      fileName,
      bytesBase64: encodeBytesAsBase64(bytes),
    };
    await webview.postMessage(message);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    channel.appendLine(`[ext→webview] fig/error ${detail}`);
    const message: ExtensionToWebviewMessage = {
      type: "fig/error",
      uri: uri.toString(),
      message: detail,
    };
    await webview.postMessage(message);
  }
}

async function resolveFigEditor(params: {
  readonly extensionUri: vscode.Uri;
  readonly document: FigDocument;
  readonly webviewPanel: vscode.WebviewPanel;
}): Promise<void> {
  const { extensionUri, document, webviewPanel } = params;
  const channel = getHigmaOutputChannel();
  channel.appendLine(
    `[resolveCustomEditor] opening ${document.uri.toString()} in webview ${webviewPanel.viewType}`,
  );
  const nonce = buildNonce();
  webviewPanel.webview.options = {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
  };
  webviewPanel.webview.html = buildWebviewHtml({
    webview: webviewPanel.webview,
    extensionUri,
    nonce,
  });
  channel.appendLine("[resolveCustomEditor] webview html assigned, waiting for webview/ready…");

  const disposables: vscode.Disposable[] = [];
  const sendDocument = (): Promise<void> =>
    postFigBytes({ webview: webviewPanel.webview, uri: document.uri });

  disposables.push(
    webviewPanel.webview.onDidReceiveMessage((raw: unknown) => {
      const message = parseWebviewMessage(raw);
      if (!message) {
        channel.appendLine(
          `[webview→ext] dropped unparseable message: ${JSON.stringify(raw).slice(0, 200)}`,
        );
        return;
      }
      if (message.type === "webview/ready") {
        channel.appendLine("[webview→ext] webview/ready received → posting fig/loaded");
        void sendDocument();
        return;
      }
      if (message.type === "webview/log") {
        forwardLog(message.level, message.message);
      }
    }),
  );

  const dirUri = vscode.Uri.joinPath(document.uri, "..");
  const filePattern = document.uri.path.split("/").slice(-1)[0] ?? "*.fig";
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(dirUri, filePattern),
  );
  disposables.push(watcher);
  disposables.push(watcher.onDidChange(() => void sendDocument()));

  webviewPanel.onDidDispose(() => {
    while (disposables.length > 0) {
      const next = disposables.pop();
      if (next) {
        next.dispose();
      }
    }
  });
}

/**
 * Registers the `.fig` custom readonly editor with VS Code.
 *
 * Returns the disposable returned by `vscode.window.registerCustomEditorProvider`
 * so the extension entry can attach it to `context.subscriptions`.
 */
export function registerFigViewer(context: vscode.ExtensionContext): vscode.Disposable {
  const provider: vscode.CustomReadonlyEditorProvider<FigDocument> = {
    openCustomDocument(uri) {
      return createFigDocument(uri);
    },
    async resolveCustomEditor(document, webviewPanel) {
      await resolveFigEditor({
        extensionUri: context.extensionUri,
        document,
        webviewPanel,
      });
    },
  };
  return vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
    webviewOptions: {
      retainContextWhenHidden: true,
    },
    supportsMultipleEditorsPerDocument: false,
  });
}

function parseWebviewMessage(raw: unknown): WebviewToExtensionMessage | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const candidate = raw as { type?: unknown };
  if (candidate.type === "webview/ready") {
    return { type: "webview/ready" };
  }
  if (candidate.type === "webview/log") {
    return parseWebviewLogMessage(raw);
  }
  return undefined;
}

function parseWebviewLogMessage(raw: unknown): WebviewToExtensionMessage | undefined {
  const log = raw as { level?: unknown; message?: unknown };
  if (
    log.level !== "info" &&
    log.level !== "warn" &&
    log.level !== "error"
  ) {
    return undefined;
  }
  if (typeof log.message !== "string") {
    return undefined;
  }
  return { type: "webview/log", level: log.level, message: log.message };
}

function forwardLog(level: "info" | "warn" | "error", message: string): void {
  getHigmaOutputChannel().appendLine(`[${level}] ${message}`);
}
