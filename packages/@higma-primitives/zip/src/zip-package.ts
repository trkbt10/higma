/**
 * @file ZIP package for file-family containers
 */

import type { ZipGenerateOptions, ZipPackage, ZipReadablePackage } from "./types";
import { readZipEntries } from "./zip-reader";
import { writeZipEntries } from "./zip-writer";

const DEFAULT_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".tiff",
  ".tif",
  ".wmf",
  ".emf",
  ".svg",
  ".bin",
  ".ole",
  ".vml",
  ".wav",
  ".mp3",
  ".mp4",
  ".m4a",
  ".wma",
  ".wmv",
  ".avi",
]);
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function toUint8Array(content: ArrayBuffer | Uint8Array): Uint8Array {
  if (!(content instanceof Uint8Array)) {
    return new Uint8Array(content);
  }

  const isWholeBuffer =
    content.byteOffset === 0 && content.byteLength === content.buffer.byteLength;
  if (isWholeBuffer) {
    return content;
  }
  return content.slice();
}

/** Load a ZIP package from bytes. */
export async function loadZipPackage(buffer: ArrayBuffer | Uint8Array): Promise<ZipPackage> {
  return createZipPackageFromEntries(readZipEntries(buffer));
}

/** Create an empty ZIP package. */
export function createEmptyZipPackage(): ZipPackage {
  return createZipPackageFromEntries(new Map());
}

function createZipPackageFromEntries(initialEntries: ReadonlyMap<string, Uint8Array>): ZipPackage {
  const entries = new Map<string, Uint8Array>(initialEntries);
  const textCache = new Map<string, string>();

  const zipPackage: ZipPackage = {
    readText(path: string): string | null {
      const cached = textCache.get(path);
      if (cached !== undefined) {
        return cached;
      }

      const bytes = entries.get(path);
      if (!bytes) {
        return null;
      }

      const text = textDecoder.decode(bytes);
      textCache.set(path, text);
      return text;
    },

    readBinary(path: string): ArrayBuffer | null {
      const bytes = entries.get(path);
      if (!bytes) {
        return null;
      }
      return toArrayBuffer(bytes);
    },

    exists(path: string): boolean {
      return entries.has(path);
    },

    listFiles(): readonly string[] {
      return Array.from(entries.keys());
    },

    writeText(path: string, content: string): void {
      entries.set(path, textEncoder.encode(content));
      textCache.set(path, content);
    },

    writeBinary(path: string, content: ArrayBuffer | Uint8Array): void {
      entries.set(path, toUint8Array(content));
      textCache.delete(path);
    },

    remove(path: string): void {
      entries.delete(path);
      textCache.delete(path);
    },

    async toBlob(options: ZipGenerateOptions = {}): Promise<Blob> {
      const compressionLevel = options.compressionLevel ?? 6;
      const mimeType = options.mimeType ?? DEFAULT_MIME_TYPE;
      const bytes = writeZipEntries(entries, { compressionLevel });
      return new Blob([bytes as BlobPart], { type: mimeType });
    },

    async toArrayBuffer(options: ZipGenerateOptions = {}): Promise<ArrayBuffer> {
      const compressionLevel = options.compressionLevel ?? 6;
      return toArrayBuffer(writeZipEntries(entries, { compressionLevel }));
    },

    asReadablePackage(): ZipReadablePackage {
      return {
        readText: (path) => zipPackage.readText(path),
        readBinary: (path) => zipPackage.readBinary(path),
        exists: (path) => zipPackage.exists(path),
        listFiles: () => zipPackage.listFiles(),
      };
    },
  };

  return zipPackage;
}

/** Check whether a path conventionally stores binary archive payload. */
export function isBinaryFile(path: string): boolean {
  const lowerPath = path.toLowerCase();
  const lastDot = lowerPath.lastIndexOf(".");
  if (lastDot === -1) {
    return false;
  }
  return BINARY_EXTENSIONS.has(lowerPath.slice(lastDot));
}
