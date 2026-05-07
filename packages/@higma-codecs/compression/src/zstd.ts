/**
 * @file Zstandard compression/decompression
 *
 * Uses fzstd for decompression (sync) and zstd-codec for compression (async).
 *
 * zstd-codec is loaded lazily via dynamic import() to avoid a bun bundler bug
 * where the CJS module's `module.ZstdCodec = {}` line is miscompiled into a
 * reference to an undeclared `module_zstd_codec` variable. The static
 * `import { ZstdCodec }` form (kept here previously) was enough to trigger
 * the miscompile even when consumers never called the compressor — it
 * crashed every webview consumer on script evaluation. Lazy loading also
 * avoids paying the WASM initialization cost when only decompression
 * (fzstd, sync) is needed.
 */

import { decompress as fzstdDecompress } from "fzstd";
import type { ZstdSimple } from "zstd-codec";

type ZstdCodecModule = {
  readonly ZstdCodec: {
    run(callback: (binding: { Simple: new () => ZstdSimple }) => void): void;
  };
};

let zstdCodecModulePromise: Promise<ZstdCodecModule> | null = null;

function loadZstdCodec(): Promise<ZstdCodecModule> {
  if (!zstdCodecModulePromise) {
    // Inline ignore is required because TypeScript's resolver pre-evaluates
    // the literal specifier; we want the module loaded only on demand.
    zstdCodecModulePromise = import("zstd-codec") as unknown as Promise<ZstdCodecModule>;
  }
  return zstdCodecModulePromise;
}

/**
 * Decompress zstd data (sync).
 *
 * @param data - Compressed data
 * @returns Decompressed data
 */
export function decompressZstd(data: Uint8Array): Uint8Array {
  return fzstdDecompress(data);
}

/**
 * Zstd compressor instance.
 * Use createZstdCompressor() to create one.
 */
export type ZstdCompressor = {
  /**
   * Compress data using Zstandard.
   *
   * @param data - Data to compress
   * @param level - Compression level (1-22, default: 3)
   * @returns Compressed data
   */
  compress(data: Uint8Array, level?: number): Uint8Array;
};

export async function createZstdCompressor(): Promise<ZstdCompressor> {
  const { ZstdCodec } = await loadZstdCodec();
  return new Promise<ZstdCompressor>((resolve, reject) => {
    ZstdCodec.run((binding) => {
      try {
        const simple: ZstdSimple = new binding.Simple();
        resolve({
          compress(data: Uint8Array, level: number = 3): Uint8Array {
            const result = simple.compress(data, level);
            if (result === null) {
              throw new Error("zstd compression failed");
            }
            return new Uint8Array(result);
          },
        });
      } catch (e) {
        reject(e);
      }
    });
  });
}

/**
 * Compress data using Zstandard (one-shot convenience function).
 * Creates a temporary compressor for the operation.
 *
 * For multiple compressions, create a compressor with createZstdCompressor()
 * and reuse it for better performance.
 *
 * @param data - Data to compress
 * @param level - Compression level (1-22, default: 3)
 * @returns Compressed data
 */
export async function compressZstd(data: Uint8Array, level: number = 3): Promise<Uint8Array> {
  const compressor = await createZstdCompressor();
  return compressor.compress(data, level);
}
