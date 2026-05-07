/**
 * @file Shared types for the inspect-panel export controls and the
 * pipeline that fulfils them.
 */

import type { FigNodeId } from "@higma-document-models/fig/domain";

export type ExportFormat = "PNG" | "JPEG" | "SVG";

export type ExportRequest = {
  readonly nodeId: FigNodeId;
  readonly format: ExportFormat;
  readonly scale: number;
  readonly suffix: string;
  readonly baseName: string;
};
