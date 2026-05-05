/**
 * @file High-level fig file parsing API
 */

import type { KiwiSchema } from "@higma-codecs/kiwi/types";
import {
  decodeFigmaKiwiCanvas,
  decodeRawFigmaKiwiCanvas,
} from "@higma-figma-runtime/kiwi-canvas";
import type { FigNode } from "../types";
import {
  isZipPackage,
  type FigPackageImage,
} from "@higma-figma-containers/package";
import type { FigBlob } from "./blob-decoder";
import { normaliseNodeChanges, asBlobArray } from "./normalize";

// =============================================================================
// Parsed Fig File Result
// =============================================================================

/**
 * Image data extracted from .fig file
 */
export type FigImage = FigPackageImage;

/**
 * Result of parsing a .fig file
 */
export type ParsedFigFile = {
  /** Decoded schema */
  readonly schema: KiwiSchema;
  /** Node changes from the message */
  readonly nodeChanges: readonly FigNode[];
  /** Blobs containing path data, images, etc. */
  readonly blobs: readonly FigBlob[];
  /** Images extracted from the ZIP (keyed by imageRef) */
  readonly images: ReadonlyMap<string, FigImage>;
  /** Raw message data */
  readonly message: Record<string, unknown>;
};

// =============================================================================
// Fig File Parsing
// =============================================================================

/**
 * Parse raw fig-kiwi data (not ZIP wrapped)
 */
function parseRawFigData(data: Uint8Array, images: ReadonlyMap<string, FigImage> = new Map()): ParsedFigFile {
  const decoded = decodeRawFigmaKiwiCanvas(data, images);
  const nodeChanges = normaliseNodeChanges(decoded.nodeChanges);
  const blobs = asBlobArray(decoded.blobs);

  return {
    schema: decoded.schema,
    nodeChanges,
    blobs,
    images: decoded.images,
    message: decoded.message,
  };
}

/**
 * Parse a .fig file and extract node changes
 *
 * Supports both:
 * - Raw fig-kiwi format (starts with "fig-kiwi")
 * - ZIP-wrapped format (Figma's actual .fig export format)
 *
 * @param data - Raw .fig file bytes
 * @returns Parsed schema and nodes
 */
export async function parseFigFile(data: Uint8Array): Promise<ParsedFigFile> {
  const decoded = await decodeFigmaKiwiCanvas(data);
  const nodeChanges = normaliseNodeChanges(decoded.nodeChanges);
  const blobs = asBlobArray(decoded.blobs);
  return {
    schema: decoded.schema,
    nodeChanges,
    blobs,
    images: decoded.images,
    message: decoded.message,
  };
}

/**
 * Parse a .fig file synchronously (only works with raw fig-kiwi format)
 *
 * @param data - Raw fig-kiwi format bytes
 * @returns Parsed schema and nodes
 */
export function parseFigFileSync(data: Uint8Array): ParsedFigFile {
  if (isZipPackage(data)) {
    throw new Error("ZIP-wrapped .fig files require async parsing. Use parseFigFile() instead.");
  }
  return parseRawFigData(data);
}

/**
 * Check if data is a Figma ZIP file
 */
export function isFigmaZipFile(data: Uint8Array): boolean {
  return isZipPackage(data);
}
