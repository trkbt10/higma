/**
 * @file WebGL texture lifecycle management
 *
 * Caches textures by image reference to avoid redundant uploads.
 */

import type { TextureColorManagement, TextureResource } from "./texture-resource";

export type TextureEntry = {
  readonly texture: WebGLTexture;
  readonly width: number;
  readonly height: number;
  refCount: number;
};

export type TextureUploadOptions = {
  readonly colorManagement: TextureColorManagement;
};

/**
 * WebGL texture cache interface
 *
 * Manages texture lifecycle with reference counting.
 */
export type TextureCache = {
  /** Prepare a texture for rendering without adding a transient draw reference. */
  prepare(resource: TextureResource, data: Uint8Array, mimeType: string, options: TextureUploadOptions): Promise<TextureEntry>;
  /** Get or create a texture from image data */
  getOrCreate(resource: TextureResource, data: Uint8Array, mimeType: string, options: TextureUploadOptions): Promise<TextureEntry>;
  /** Synchronous lookup for an already-cached texture */
  getIfCached(resource: TextureResource): TextureEntry | null;
  /** Release a texture reference */
  release(resource: TextureResource): void;
  /** Dispose all cached textures */
  dispose(): void;
};

/** Create a new WebGL texture cache */
export function createTextureCache(gl: WebGLRenderingContext): TextureCache {
  const cache = new Map<string, TextureEntry>();
  const pendingUploads = new Map<string, Promise<TextureEntry>>();

  /** Configure standard texture parameters */
  function configureTextureParams(): void {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  function shouldColorManage(options: TextureUploadOptions): boolean {
    return options.colorManagement.kind === "managed";
  }

  function resolveImageBitmapOptions(options: TextureUploadOptions): ImageBitmapOptions {
    return { colorSpaceConversion: shouldColorManage(options) ? "default" : "none" };
  }

  function applyColorManagement(options: TextureUploadOptions): void {
    applyUnpackColorSpace(options);
    gl.pixelStorei(
      gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,
      shouldColorManage(options) ? gl.BROWSER_DEFAULT_WEBGL : gl.NONE,
    );
  }

  function applyUnpackColorSpace(options: TextureUploadOptions): void {
    if (options.colorManagement.kind === "unmanaged") {
      return;
    }
    const target = options.colorManagement.targetColorProfile;
    const colorManagedGl = gl as WebGLRenderingContext & {
      unpackColorSpace?: "srgb" | "display-p3";
    };
    if (target === "DISPLAY_P3_V4") {
      requireUnpackColorSpace(colorManagedGl);
      colorManagedGl.unpackColorSpace = "display-p3";
      return;
    }
    if (colorManagedGl.unpackColorSpace !== undefined) {
      colorManagedGl.unpackColorSpace = "srgb";
    }
  }

  function requireUnpackColorSpace(
    colorManagedGl: WebGLRenderingContext & { unpackColorSpace?: "srgb" | "display-p3" },
  ): void {
    if (colorManagedGl.unpackColorSpace === undefined) {
      throw new Error("Display P3 WebGL texture upload requires WebGLRenderingContext.unpackColorSpace support");
    }
  }

  async function uploadTexture(resource: TextureResource, data: Uint8Array, mimeType: string, options: TextureUploadOptions): Promise<TextureEntry> {
    // `Uint8Array<ArrayBufferLike>` is structurally a valid `BlobPart`
    // (BufferSource), but TS lib variants disagree on the assignability
    // due to recent ArrayBuffer-vs-SharedArrayBuffer narrowing. Keep
    // the cast scoped to this single boundary.
    const blob = new Blob([data as BlobPart], { type: mimeType });
    const bitmapOptions = resolveImageBitmapOptions(options);
    const bitmap = await createImageBitmap(blob, bitmapOptions);

    const texture = gl.createTexture();
    if (!texture) {
      bitmap.close();
      throw new Error(`Failed to create WebGL texture for image resource: ${resource.id}`);
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);
    applyColorManagement(options);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    configureTextureParams();

    const entry: TextureEntry = {
      texture,
      width: bitmap.width,
      height: bitmap.height,
      refCount: 1,
    };

    bitmap.close();
    cache.set(resource.id, entry);
    return entry;
  }

  async function prepareTexture(resource: TextureResource, data: Uint8Array, mimeType: string, options: TextureUploadOptions): Promise<TextureEntry> {
    const existing = cache.get(resource.id);
    if (existing) {
      return existing;
    }

    const pending = pendingUploads.get(resource.id);
    if (pending) {
      return pending;
    }

    const upload = uploadTexture(resource, data, mimeType, options);
    pendingUploads.set(resource.id, upload);
    try {
      return await upload;
    } finally {
      pendingUploads.delete(resource.id);
    }
  }

  return {
    prepare(resource, data, mimeType, options) {
      return prepareTexture(resource, data, mimeType, options);
    },

    async getOrCreate(resource, data, mimeType, options) {
      const existing = cache.get(resource.id);
      if (existing) {
        existing.refCount++;
        return existing;
      }
      const pending = pendingUploads.get(resource.id);
      if (pending) {
        const entry = await pending;
        entry.refCount++;
        return entry;
      }
      return prepareTexture(resource, data, mimeType, options);
    },

    getIfCached(resource) {
      const entry = cache.get(resource.id);
      if (entry === undefined) {
        return null;
      }
      return entry;
    },

    release(resource) {
      const entry = cache.get(resource.id);
      if (!entry) {return;}

      entry.refCount--;
      if (entry.refCount <= 0) {
        gl.deleteTexture(entry.texture);
        cache.delete(resource.id);
      }
    },

    dispose() {
      pendingUploads.clear();
      for (const entry of cache.values()) {
        gl.deleteTexture(entry.texture);
      }
      cache.clear();
    },
  };
}
