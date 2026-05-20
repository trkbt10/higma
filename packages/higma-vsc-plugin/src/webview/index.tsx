/**
 * @file Webview entry point for the Higma `.fig` viewer.
 *
 * Mounts the React tree, listens for messages from the extension host
 * (the `fig/loaded` payload carrying base64-encoded fig bytes), parses
 * the document via `@higma-document-io/fig`, and renders it.
 */

import { Component, StrictMode, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createFigDocumentContext, type FigDocumentContext } from "@higma-document-io/fig";
import type { ExtensionToWebviewMessage } from "../shared/protocol";
import { FigViewer } from "./FigViewer";
import { postToExtension } from "./vscode-api";

// Set the marker the bootstrap inline script polls so it can tell that
// the module bundle actually executed.
function markModuleRan(): void {
  if (typeof window === "undefined") {
    return;
  }
  Reflect.set(window, "__higmaModuleRan", true);
}
markModuleRan();

type LoadState =
  | { readonly status: "idle" }
  | { readonly status: "loading"; readonly fileName: string }
  | { readonly status: "ready"; readonly fileName: string; readonly context: FigDocumentContext }
  | { readonly status: "error"; readonly fileName: string; readonly message: string };

/**
 * Forwards a webview-side error to the extension host as `webview/log` so
 * a failure that would otherwise be visible only in the webview's
 * DevTools (which is closed by default) reaches the extension host
 * console / output panel.
 *
 * Defensive: a host that has not yet injected `acquireVsCodeApi` would
 * make `postToExtension` throw, which we silently swallow rather than
 * recursing into the same error path.
 */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}\n${error.stack ?? ""}`;
  }
  return String(error);
}

function reportError(scope: string, error: unknown, extra?: string): void {
  const detail = describeError(error);
  const message = extra ? `[${scope}] ${detail}\n${extra}` : `[${scope}] ${detail}`;
  // Always log locally so the webview DevTools shows it.
  // (This stays useful when the host channel below is unavailable.)
  console.error(message);
  try {
    postToExtension({ type: "webview/log", level: "error", message });
  } catch (forwardError: unknown) {
    // Host channel not yet initialised; surface the forwarding failure
    // locally so a misconfigured harness is still debuggable from the
    // webview DevTools.
    console.error("[higma-vsc-plugin] failed to forward error to host", forwardError);
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("error", (event) => {
    reportError("window.error", event.error ?? event.message ?? "unknown");
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportError("unhandledrejection", event.reason ?? "unknown");
  });
}

/**
 * Pending `fig/loaded` payloads delivered before the React tree had a
 * chance to mount its `message` listener. The harness flushes these
 * into the listener as soon as `App` registers it.
 *
 * Without this buffer, the eager `webview/ready` post (below) means the
 * extension can ship `fig/loaded` *before* React commit completes, and
 * the document silently disappears.
 */
const pendingExtensionMessages: ExtensionToWebviewMessage[] = [];
const liveMessageListenerRef: { current: ((event: MessageEvent<unknown>) => void) | null } = { current: null };

if (typeof window !== "undefined") {
  // Stand-alone listener active *immediately* — independent of React
  // mount lifecycle. Drains directly into the React listener once the
  // App effect attaches one, otherwise queues for replay.
  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (liveMessageListenerRef.current) {
      liveMessageListenerRef.current(event);
      return;
    }
    const parsed = parseExtensionMessage(event.data);
    if (parsed) {
      pendingExtensionMessages.push(parsed);
    }
  });
}

/**
 * Post `webview/ready` synchronously at module evaluation time, mirroring
 * the pattern used by `web-pptx/publish/aurochs-office-viewer`. Doing it
 * *before* React mount means the extension can rely on `webview/ready`
 * arriving even when the React tree fails to commit (broken bundle, top
 * level import throw, etc.) — which previously left the webview hung on
 * the `Loading webview script…` placeholder forever.
 */
try {
  postToExtension({ type: "webview/ready" });
} catch (error: unknown) {
  // No host channel — only possible outside a real VS Code webview
  // (e.g. the e2e harness, which installs its own stub before this
  // module loads). The harness logs the failure on its side.
  console.error("[higma-vsc-plugin] eager webview/ready failed:", error);
}

// React's Error Boundary contract is class-only — `getDerivedStateFromError`
// + `componentDidCatch` have no hook equivalent. The repo's "no class" rule
// is suspended here because the alternative is "no error boundary at all."
// eslint-disable-next-line no-restricted-syntax -- React Error Boundary requires class
class WebviewErrorBoundary extends Component<
  { readonly children: ReactNode },
  { readonly error: Error | null }
> {
  override state: { readonly error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { readonly error: Error } {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    reportError("react-render", error, info.componentStack ?? "");
  }

  override render(): ReactNode {
    if (this.state.error) {
      const message = this.state.error.message || String(this.state.error);
      return (
        <div className="higma-fig-app">
          <div className="higma-fig-stage">
            <div className="higma-fig-status higma-fig-status--error">
              <div>The viewer crashed while rendering this document.</div>
              <code>{message}</code>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function parseExtensionMessage(raw: unknown): ExtensionToWebviewMessage | undefined {
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
  return undefined;
}

function parseLoadedMessage(raw: unknown): ExtensionToWebviewMessage | undefined {
  const message = raw as {
    uri?: unknown;
    fileName?: unknown;
    bytesBase64?: unknown;
  };
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

async function loadFigDocument(params: {
  readonly fileName: string;
  readonly bytesBase64: string;
  readonly setState: (state: LoadState) => void;
}): Promise<void> {
  const { fileName, bytesBase64, setState } = params;
  try {
    const bytes = decodeBase64(bytesBase64);
    const context = await createFigDocumentContext(bytes);
    setState({ status: "ready", fileName, context });
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    postToExtension({
      type: "webview/log",
      level: "error",
      message: `failed to parse ${fileName}: ${detail}`,
    });
    setState({ status: "error", fileName, message: detail });
  }
}

function App() {
  const [state, setState] = useState<LoadState>({ status: "idle" });

  useEffect(() => {
    const handleMessage = (message: ExtensionToWebviewMessage): void => {
      if (message.type === "fig/error") {
        setState({ status: "error", fileName: "", message: message.message });
        return;
      }
      const { fileName, bytesBase64 } = message;
      setState({ status: "loading", fileName });
      void loadFigDocument({ fileName, bytesBase64, setState });
    };
    const onMessageEvent = (event: MessageEvent<unknown>): void => {
      const parsed = parseExtensionMessage(event.data);
      if (parsed) {
        handleMessage(parsed);
      }
    };
    // Drain anything the global pre-mount listener buffered while the
    // React tree was still committing.
    while (pendingExtensionMessages.length > 0) {
      const queued = pendingExtensionMessages.shift();
      if (queued) {
        handleMessage(queued);
      }
    }
    liveMessageListenerRef.current = onMessageEvent;
    return () => {
      if (liveMessageListenerRef.current === onMessageEvent) {
        liveMessageListenerRef.current = null;
      }
    };
  }, []);

  if (state.status === "idle" || state.status === "loading") {
    return (
      <div className="higma-fig-app">
        <div className="higma-fig-stage">
          <div className="higma-fig-status">
            {state.status === "idle" ? "Waiting for document…" : `Loading ${state.fileName}…`}
          </div>
        </div>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="higma-fig-app">
        <div className="higma-fig-stage">
          <div className="higma-fig-status higma-fig-status--error">
            <div>Failed to open the .fig document.</div>
            <code>{state.message}</code>
          </div>
        </div>
      </div>
    );
  }
  return <FigViewer fileName={state.fileName} context={state.context} />;
}

const container = document.getElementById("higma-fig-root");
if (!container) {
  throw new Error("higma-vsc-plugin webview: missing #higma-fig-root mount node");
}
createRoot(container).render(
  <StrictMode>
    <WebviewErrorBoundary>
      <App />
    </WebviewErrorBoundary>
  </StrictMode>,
);
