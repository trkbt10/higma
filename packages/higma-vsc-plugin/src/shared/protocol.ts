/**
 * @file Wire protocol shared between the VS Code extension host and the
 * webview that renders `.fig` previews.
 *
 * Messages are JSON-serialisable. Binary fig payloads are transferred as
 * base64 strings so they survive `postMessage` without `Transferable`
 * support requirements.
 */

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
    };

export type WebviewToExtensionMessage =
  | {
      readonly type: "webview/ready";
    }
  | {
      readonly type: "webview/log";
      readonly level: "info" | "warn" | "error";
      readonly message: string;
    };
