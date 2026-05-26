/** @file WebGL texture resource keys. */

import type { FigmaExportColorProfile } from "@higma-codecs/raster";

export type TextureResourceId = string & { readonly __brand: "TextureResourceId" };

export type TextureColorManagement =
  | { readonly kind: "unmanaged" }
  | { readonly kind: "managed"; readonly targetColorProfile: FigmaExportColorProfile };

export type ImageTextureResource = {
  readonly kind: "image";
  readonly id: TextureResourceId;
  readonly imageHash: string;
  readonly colorManagement: TextureColorManagement;
};

export type TextureResource = ImageTextureResource;

function makeTextureResourceId(value: string): TextureResourceId {
  return value as TextureResourceId;
}

function textureColorManagementKey(colorManagement: TextureColorManagement): string {
  if (colorManagement.kind === "managed") {
    return `color-managed:${colorManagement.targetColorProfile}`;
  }
  return "color:unmanaged";
}

/** Build the domain key for an image texture. */
export function imageTextureResource(imageHash: string, colorManagement: TextureColorManagement): ImageTextureResource {
  if (imageHash.length === 0) {
    throw new Error("imageTextureResource requires a non-empty image hash");
  }
  const colorManagementKey = textureColorManagementKey(colorManagement);
  return {
    kind: "image",
    id: makeTextureResourceId(`image:${imageHash}:${colorManagementKey}`),
    imageHash,
    colorManagement,
  };
}
