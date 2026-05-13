/**
 * @file Build a `LintContext` from raw bytes without throwing.
 *
 * The lint pipeline is fail-tolerant: every parsing step records its
 * own error as a finding and produces the most-complete context it
 * can. Later rules check whether the fields they need are populated
 * before doing any work. That keeps the surface flat — no try/catch
 * inside individual rules.
 *
 * NOTE: this module does **not** throw, but it also does not silently
 * swallow surprises. Whenever a parse step fails, the raised Error is
 * routed into a finding by the caller (see `health-check.ts`). The
 * caller is the only place that bridges thrown errors and findings.
 */

import { decompressFigChunk } from "@higma-codecs/compression";
import {
  decodeFigMessage,
  decodeFigSchema,
  splitFigChunks,
} from "@higma-codecs/kiwi/decoder";
import {
  getFigCanvasPayload,
  isFigCanvas,
  parseFigCanvasHeader,
  type FigCanvasHeader,
} from "@higma-figma-containers/canvas";
import {
  FIG_THUMBNAIL_ZIP_ENTRY,
  isZipPackage,
  parseFigPackageMetadata,
  getFigPackageImageMimeType,
  type FigPackageImage,
  type FigPackageMetadata,
} from "@higma-figma-containers/package";
import { loadZipPackage } from "@higma-primitives/zip";
import type { KiwiSchema } from "@higma-codecs/kiwi/types";
import type { FigNode } from "@higma-document-models/fig/types";
import { normaliseNodeChanges } from "../parser/normalize";
import type { LintContext, LintFinding } from "./types";

type StepError = {
  readonly ruleId: LintFinding["ruleId"];
  readonly path: string;
  readonly message: string;
};

/**
 * Result of context construction. Errors collected here are appended
 * to the run's findings before rules execute.
 */
export type LintContextBuild = {
  readonly context: LintContext;
  readonly errors: readonly StepError[];
};

function readEntries(zipPackage: { listFiles: () => readonly string[]; readBinary: (name: string) => ArrayBuffer | null }): ReadonlyMap<string, Uint8Array> {
  const entries = new Map<string, Uint8Array>();
  for (const name of zipPackage.listFiles()) {
    const data = zipPackage.readBinary(name);
    if (data) {
      entries.set(name, new Uint8Array(data));
    }
  }
  return entries;
}

function pickCanvasData(entries: ReadonlyMap<string, Uint8Array>): Uint8Array | null {
  const ordered = ["canvas.fig", "thumbnail.fig"];
  for (const name of ordered) {
    const data = entries.get(name);
    if (data) {
      return data;
    }
  }
  return null;
}

function extractImages(entries: ReadonlyMap<string, Uint8Array>): ReadonlyMap<string, FigPackageImage> {
  const images = new Map<string, FigPackageImage>();
  for (const [name, data] of entries) {
    if (name.startsWith("images/") && name.length > "images/".length) {
      const ref = name.substring("images/".length);
      images.set(ref, {
        ref,
        data,
        mimeType: getFigPackageImageMimeType(name, data),
      });
    }
  }
  return images;
}

function extractMetadata(entries: ReadonlyMap<string, Uint8Array>, errors: StepError[]): FigPackageMetadata | null {
  const data = entries.get("meta.json");
  if (!data) {
    return null;
  }
  const text = new TextDecoder().decode(data);
  try {
    return parseFigPackageMetadata(text);
  } catch (err) {
    errors.push({
      ruleId: "fig.zip.meta",
      path: "zip/meta.json",
      message: `meta.json could not be parsed: ${(err as Error).message}`,
    });
    return null;
  }
}

function toUnknownArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value;
}

type DecodeChainResult = {
  readonly canvasData: Uint8Array | null;
  readonly canvasHeader: FigCanvasHeader | null;
  readonly schema: KiwiSchema | null;
  readonly message: Record<string, unknown> | null;
  readonly nodeChanges: readonly FigNode[];
};

function decodeChain(canvasData: Uint8Array | null, errors: StepError[]): DecodeChainResult {
  if (!canvasData) {
    return { canvasData: null, canvasHeader: null, schema: null, message: null, nodeChanges: [] };
  }

  if (!isFigCanvas(canvasData)) {
    errors.push({
      ruleId: "fig.canvas.header",
      path: "canvas.fig",
      message: "canvas.fig does not start with a known fig-family magic header",
    });
    return { canvasData, canvasHeader: null, schema: null, message: null, nodeChanges: [] };
  }

  const headerResult = (() => {
    try {
      return { ok: true as const, header: parseFigCanvasHeader(canvasData) };
    } catch (err) {
      return { ok: false as const, message: (err as Error).message };
    }
  })();

  if (!headerResult.ok) {
    errors.push({ ruleId: "fig.canvas.header", path: "canvas.fig/header", message: headerResult.message });
    return { canvasData, canvasHeader: null, schema: null, message: null, nodeChanges: [] };
  }

  const header = headerResult.header;
  const payload = getFigCanvasPayload(canvasData);

  const chunkResult = (() => {
    try {
      return { ok: true as const, chunks: splitFigChunks(payload, header.payloadSize) };
    } catch (err) {
      return { ok: false as const, message: (err as Error).message };
    }
  })();

  if (!chunkResult.ok) {
    errors.push({ ruleId: "fig.canvas.payload-size", path: "canvas.fig/payload", message: chunkResult.message });
    return { canvasData, canvasHeader: header, schema: null, message: null, nodeChanges: [] };
  }

  const schemaResult = (() => {
    try {
      const decompressed = decompressFigChunk(chunkResult.chunks.schema);
      return { ok: true as const, schema: decodeFigSchema(decompressed) };
    } catch (err) {
      return { ok: false as const, message: (err as Error).message };
    }
  })();

  if (!schemaResult.ok) {
    errors.push({ ruleId: "fig.schema.coverage", path: "canvas.fig/schema", message: schemaResult.message });
    return { canvasData, canvasHeader: header, schema: null, message: null, nodeChanges: [] };
  }

  const messageResult = (() => {
    try {
      const decompressed = decompressFigChunk(chunkResult.chunks.data);
      return { ok: true as const, message: decodeFigMessage(schemaResult.schema, decompressed, "Message") };
    } catch (err) {
      return { ok: false as const, message: (err as Error).message };
    }
  })();

  if (!messageResult.ok) {
    errors.push({ ruleId: "fig.message.decode", path: "canvas.fig/message", message: messageResult.message });
    return { canvasData, canvasHeader: header, schema: schemaResult.schema, message: null, nodeChanges: [] };
  }

  const nodeChanges = normaliseNodeChanges(toUnknownArray(messageResult.message.nodeChanges));
  return {
    canvasData,
    canvasHeader: header,
    schema: schemaResult.schema,
    message: messageResult.message,
    nodeChanges,
  };
}

/**
 * Build a `LintContext` for `bytes` without throwing.
 *
 * Returns the context plus a list of step errors that the caller must
 * forward to the lint report so they show up as findings.
 */
export async function buildLintContext(bytes: Uint8Array): Promise<LintContextBuild> {
  const errors: StepError[] = [];
  const isZip = isZipPackage(bytes);

  const zipEntries = await (async () => {
    if (!isZip) {
      return new Map<string, Uint8Array>();
    }
    try {
      const zipPackage = await loadZipPackage(bytes);
      return readEntries(zipPackage);
    } catch (err) {
      errors.push({
        ruleId: "fig.zip.header",
        path: "zip",
        message: `ZIP package could not be opened: ${(err as Error).message}`,
      });
      return new Map<string, Uint8Array>();
    }
  })();

  const canvasData = (() => {
    if (isZip) {
      return pickCanvasData(zipEntries);
    }
    return bytes;
  })();

  if (isZip && !canvasData) {
    errors.push({
      ruleId: "fig.zip.canvas-entry",
      path: "zip/canvas.fig",
      message: "ZIP package does not contain canvas.fig (or thumbnail.fig)",
    });
  }

  const decoded = decodeChain(canvasData, errors);
  const images = isZip ? extractImages(zipEntries) : new Map<string, FigPackageImage>();
  const metadata = isZip ? extractMetadata(zipEntries, errors) : null;
  const hasThumbnail = zipEntries.has(FIG_THUMBNAIL_ZIP_ENTRY);

  const context: LintContext = {
    bytes,
    isZip,
    zipEntries,
    canvasData: decoded.canvasData,
    canvasHeader: decoded.canvasHeader,
    schema: decoded.schema,
    message: decoded.message,
    nodeChanges: decoded.nodeChanges,
    images,
    metadata,
    hasThumbnail,
  };

  return { context, errors };
}
