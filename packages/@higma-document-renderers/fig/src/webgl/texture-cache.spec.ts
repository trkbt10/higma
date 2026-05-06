/** @file WebGL texture cache tests. */

import { createTextureCache } from "./texture-cache";
import { imageTextureResource } from "./texture-resource";

type TextureFakeGL = Pick<
  WebGLRenderingContext,
  "createTexture" | "bindTexture" | "texImage2D" | "texParameteri" | "deleteTexture"
> & {
  readonly TEXTURE_2D: number;
  readonly TEXTURE_WRAP_S: number;
  readonly TEXTURE_WRAP_T: number;
  readonly CLAMP_TO_EDGE: number;
  readonly TEXTURE_MIN_FILTER: number;
  readonly TEXTURE_MAG_FILTER: number;
  readonly LINEAR: number;
  readonly RGBA: number;
  readonly UNSIGNED_BYTE: number;
};

function makeTextureFakeGL(): { readonly gl: WebGLRenderingContext; readonly calls: { uploads: number; deletes: number } } {
  const calls = { uploads: 0, deletes: 0 };
  const gl: TextureFakeGL = {
    TEXTURE_2D: 3553,
    TEXTURE_WRAP_S: 10242,
    TEXTURE_WRAP_T: 10243,
    CLAMP_TO_EDGE: 33071,
    TEXTURE_MIN_FILTER: 10241,
    TEXTURE_MAG_FILTER: 10240,
    LINEAR: 9729,
    RGBA: 6408,
    UNSIGNED_BYTE: 5121,
    createTexture: () => ({}) as WebGLTexture,
    bindTexture: () => undefined,
    texImage2D: () => {
      calls.uploads += 1;
    },
    texParameteri: () => undefined,
    deleteTexture: () => {
      calls.deletes += 1;
    },
  };
  return { gl: gl as WebGLRenderingContext, calls };
}

function installImageBitmapStub(): void {
  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true,
    value: () => Promise.resolve({
      width: 8,
      height: 6,
      close: () => undefined,
    } as ImageBitmap),
  });
}

describe("createTextureCache", () => {
  beforeEach(() => {
    installImageBitmapStub();
  });

  it("deduplicates concurrent preparation for the same resource", async () => {
    const { gl, calls } = makeTextureFakeGL();
    const cache = createTextureCache(gl);
    const resource = imageTextureResource("shared");
    const data = new Uint8Array([1, 2, 3]);

    const [first, second] = await Promise.all([
      cache.prepare(resource, data, "image/png"),
      cache.prepare(resource, data, "image/png"),
    ]);

    expect(first).toBe(second);
    expect(first.refCount).toBe(1);
    expect(calls.uploads).toBe(1);
  });

  it("keeps prepared textures cached across repeated viewport prepares", async () => {
    const { gl, calls } = makeTextureFakeGL();
    const cache = createTextureCache(gl);
    const resource = imageTextureResource("cached");
    const data = new Uint8Array([1, 2, 3]);

    await cache.prepare(resource, data, "image/png");
    await cache.prepare(resource, data, "image/png");

    expect(calls.uploads).toBe(1);
    expect(cache.getIfCached(resource)?.width).toBe(8);
  });
});
