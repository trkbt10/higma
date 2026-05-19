/** @file Browser download operations for fig exports. */

import type { FigPackageMetadata } from "@higma-figma-containers/package";
import type { FigExportResult } from "@higma-document-io/fig/export";

type FigDownloadAnchor = {
  href: string;
  download: string;
  click: () => void;
};

type FigDownloadDocument = {
  createElement: (tagName: "a") => FigDownloadAnchor;
};

type FigDownloadUrl = {
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
};

export type DownloadEnvironment = {
  readonly document: FigDownloadDocument;
  readonly url: FigDownloadUrl;
};

const FIG_EXTENSION = ".fig";
const UNTITLED_FIG_EXPORT_NAME = "untitled.fig";

function stripFigExtension(name: string): string {
  if (name.toLowerCase().endsWith(FIG_EXTENSION)) {
    return name.slice(0, -FIG_EXTENSION.length);
  }
  return name;
}

function removeInvalidFilenameCharacters(name: string): string {
  return Array.from(name).map((character) => {
    if ("<>:\"/\\|?*".includes(character) || character.charCodeAt(0) < 32) {
      return "-";
    }
    return character;
  }).join("");
}

function sanitizeFilenameBase(name: string): string {
  const trimmed = stripFigExtension(name.trim()).trim();
  const sanitized = removeInvalidFilenameCharacters(trimmed).replace(/\s+/g, " ");
  if (sanitized.replace(/[-.\s]+/g, "").length === 0) {
    return stripFigExtension(UNTITLED_FIG_EXPORT_NAME);
  }
  return sanitized;
}

/** Resolve the browser download filename for a .fig export. */
export function resolveFigExportFilename(metadata: FigPackageMetadata | null): string {
  const sourceName = metadata?.fileName ?? UNTITLED_FIG_EXPORT_NAME;
  return `${sanitizeFilenameBase(sourceName)}${FIG_EXTENSION}`;
}

/** Convert export bytes into a Blob without leaking the backing buffer range. */
export function createFigExportBlob(result: FigExportResult): Blob {
  const data = new Uint8Array(result.data);
  const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  return new Blob([bytes], { type: "application/octet-stream" });
}

/** Start a browser download for a .fig export. */
export function downloadFigExport(
  result: FigExportResult,
  filename: string,
  environment: DownloadEnvironment,
): void {
  const blob = createFigExportBlob(result);
  const url = environment.url.createObjectURL(blob);
  const anchor = environment.document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  environment.url.revokeObjectURL(url);
}
