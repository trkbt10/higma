/**
 * @file Shared ZIP package types
 */

/** Options for ZIP generation. */
export type ZipGenerateOptions = {
  readonly compressionLevel?: number;
  readonly mimeType?: string;
};

/** Minimal read-only adapter shape for consumers that need archive reads. */
export type ZipReadablePackage = {
  readText(path: string): string | null;
  readBinary(path: string): ArrayBuffer | null;
  exists(path: string): boolean;
  listFiles?(): readonly string[];
};

/** Minimal package interface for file-family containers. */
export type ZipPackage = {
  readText(path: string): string | null;
  readBinary(path: string): ArrayBuffer | null;
  exists(path: string): boolean;
  listFiles(): readonly string[];
  writeText(path: string, content: string): void;
  writeBinary(path: string, content: ArrayBuffer | Uint8Array): void;
  remove(path: string): void;
  toBlob(options?: ZipGenerateOptions): Promise<Blob>;
  toArrayBuffer(options?: ZipGenerateOptions): Promise<ArrayBuffer>;
  asReadablePackage(): ZipReadablePackage;
};
