/** @file WebGL texture resource identities. */

import type { FigmaExportColorProfile } from "../scene-graph/render";

export type TextureResourceId = string & { readonly __brand: "TextureResourceId" };

export type TextureColorManagement =
  | { readonly kind: "unmanaged" }
  | { readonly kind: "managed"; readonly targetColorProfile: FigmaExportColorProfile };

export type ImageTextureResource = {
  readonly kind: "image";
  readonly id: TextureResourceId;
  readonly imageRef: string;
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

/** Build the domain identity for an image texture. */
export function imageTextureResource(imageRef: string, colorManagement: TextureColorManagement): ImageTextureResource {
  if (imageRef.length === 0) {
    throw new Error("imageTextureResource requires a non-empty imageRef");
  }
  const colorManagementKey = textureColorManagementKey(colorManagement);
  return {
    kind: "image",
    id: makeTextureResourceId(`image:${imageRef}:${colorManagementKey}`),
    imageRef,
    colorManagement,
  };
}
