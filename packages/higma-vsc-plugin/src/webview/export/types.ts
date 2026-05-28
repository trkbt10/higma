/**
 * @file Shared types for the inspect-panel export controls and the
 * pipeline that fulfils them.
 *
 * The same request shape covers both single-node and multi-node
 * exports — the panel only specifies *how* to render (format/scale)
 * and the suffix to append; *which* nodes to render is owned by the
 * viewer's selection state, so the request stays free of node ids.
 */

export type ExportFormat = "PNG" | "JPEG" | "SVG";

export type ExportRequest = {
  readonly format: ExportFormat;
  readonly scale: number;
  readonly suffix: string;
};

/**
 * Status of a multi-node export rollup, surfaced back to the inspect
 * panel so it can show partial-failure messaging without having to
 * re-derive it from individual error strings.
 */
export type ExportRollupStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "running"; readonly completed: number; readonly total: number }
  | {
      readonly kind: "done";
      readonly succeeded: number;
      readonly failed: ReadonlyArray<{ readonly name: string; readonly message: string }>;
    };

/**
 * State of the token-export action. The JSON + CSS files emit in
 * parallel via two `viewer/exportFile` round-trips; the panel reports
 * a single rolled-up status because the two outcomes are conceptually
 * one logical export.
 */
export type TokenExportStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "running" }
  | { readonly kind: "done"; readonly fileNames: readonly string[] }
  | { readonly kind: "error"; readonly message: string };
