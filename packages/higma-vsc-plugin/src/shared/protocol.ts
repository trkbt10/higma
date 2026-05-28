/**
 * @file Wire protocol shared between the VS Code extension host and the
 * webview that renders `.fig` previews.
 *
 * Messages are JSON-serialisable. Binary fig payloads are transferred as
 * base64 strings so they survive `postMessage` without `Transferable`
 * support requirements.
 *
 * Channels:
 *   - `fig/*`     — document lifecycle (load / error).
 *   - `viewer/*`  — viewer chrome and side-effects (host-owned UI
 *                   surface state, export I/O, configuration). These
 *                   replace the in-webview toolbar so the active
 *                   custom editor can publish its zoom into the VS
 *                   Code native status bar and write export artifacts
 *                   through `workspace.fs` rather than the browser
 *                   download channel.
 *   - `webview/*` — bootstrap and forwarded diagnostics from the
 *                   webview side; unchanged from the original wiring.
 */

export type ViewerConfig = {
  /** Absolute fsPath of the directory where export artifacts are written. */
  readonly exportDirectoryFsPath: string;
  /**
   * Display string for the export directory — workspace-relative when
   * available, otherwise an `fsPath` with `$HOME` collapsed to `~`. The
   * webview shows this verbatim in the InspectPanel and does no further
   * mangling, so the host owns the formatting policy.
   */
  readonly exportDirectoryLabel: string;
};

export type ZoomCommand = "in" | "out" | "fit" | "reset";

export type ExportResultOutcome =
  | { readonly kind: "saved"; readonly savedFsPath: string }
  | { readonly kind: "error"; readonly message: string };

export type ExtensionToWebviewMessage =
  | {
      readonly type: "fig/loaded";
      readonly uri: string;
      readonly fileName: string;
      readonly bytesBase64: string;
    }
  | {
      readonly type: "fig/error";
      readonly uri: string;
      readonly message: string;
    }
  | {
      readonly type: "viewer/config";
      readonly config: ViewerConfig;
    }
  | {
      readonly type: "viewer/zoomCommand";
      readonly command: ZoomCommand;
    }
  | {
      readonly type: "viewer/exportResult";
      readonly requestId: string;
      readonly fileName: string;
      readonly outcome: ExportResultOutcome;
    };

export type WebviewToExtensionMessage =
  | {
      readonly type: "webview/ready";
    }
  | {
      readonly type: "webview/log";
      readonly level: "info" | "warn" | "error";
      readonly message: string;
    }
  | {
      readonly type: "viewer/state";
      /** Integer percentage, e.g. 100 for 1.0× zoom. */
      readonly zoomPercent: number;
      readonly fitActive: boolean;
    }
  | {
      readonly type: "viewer/exportFile";
      readonly requestId: string;
      readonly fileName: string;
      readonly mimeType: string;
      readonly bytesBase64: string;
    }
  | {
      readonly type: "viewer/chooseExportDirectory";
    };
