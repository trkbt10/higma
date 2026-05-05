/**
 * @file Figma-family ZIP package extraction
 */

import { createEmptyZipPackage, loadZipPackage } from "@higma-primitives/zip";
import { getFigPackageImageMimeType, type FigPackageImage } from "./image";
import { parseFigPackageMetadata, type FigPackageMetadata } from "./metadata";

const ZIP_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

export type FigPackageContents = {
  readonly canvasData: Uint8Array;
  readonly metadata: FigPackageMetadata | null;
  readonly thumbnail: Uint8Array | null;
  readonly images: ReadonlyMap<string, FigPackageImage>;
};

/** Return true when bytes start with the ZIP local file header magic. */
export function isZipPackage(data: Uint8Array): boolean {
  if (data.length < 4) {
    return false;
  }
  return data[0] === ZIP_MAGIC[0] && data[1] === ZIP_MAGIC[1] && data[2] === ZIP_MAGIC[2] && data[3] === ZIP_MAGIC[3];
}

function findCanvasData(zipPackage: { readBinary: (name: string) => ArrayBuffer | null }): Uint8Array | null {
  const canvasNames = ["canvas.fig", "thumbnail.fig"];
  for (const name of canvasNames) {
    const content = zipPackage.readBinary(name);
    if (content) {
      return new Uint8Array(content);
    }
  }
  return null;
}

function readPackageImages(
  files: readonly string[],
  zipPackage: { readBinary: (name: string) => ArrayBuffer | null },
): ReadonlyMap<string, FigPackageImage> {
  const images = new Map<string, FigPackageImage>();
  for (const file of files) {
    if (file.startsWith("images/") && file.length > 7) {
      const imageData = zipPackage.readBinary(file);
      if (imageData) {
        const ref = file.substring(7);
        const data = new Uint8Array(imageData);
        images.set(ref, {
          ref,
          data,
          mimeType: getFigPackageImageMimeType(file, data),
        });
      }
    }
  }
  return images;
}

/** Extract raw canvas, metadata, thumbnail, and images from a fig-family ZIP package. */
export async function extractFigPackageContents(data: Uint8Array): Promise<FigPackageContents> {
  const zipPackage = await loadZipPackage(data);
  const files = zipPackage.listFiles();
  const canvasData = findCanvasData(zipPackage);
  if (!canvasData) {
    throw new Error(`Could not find canvas.fig in ZIP. Available files: ${files.join(", ")}`);
  }

  const metaContent = zipPackage.readText("meta.json");
  const thumbnailContent = zipPackage.readBinary("thumbnail.png");
  return {
    canvasData,
    metadata: metaContent ? parseFigPackageMetadata(metaContent) : null,
    thumbnail: thumbnailContent ? new Uint8Array(thumbnailContent) : null,
    images: readPackageImages(files, zipPackage),
  };
}

/** Create an empty ZIP package for fig-family output. */
export function createFigPackage() {
  return createEmptyZipPackage();
}
