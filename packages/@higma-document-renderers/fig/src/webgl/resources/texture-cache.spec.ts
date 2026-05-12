/** @file WebGL texture cache tests. */

import { createTextureCache } from "./texture-cache";
import { imageTextureResource } from "./texture-resource";

const UNMANAGED = { kind: "unmanaged" } as const;
const SRGB_MANAGED = { kind: "managed", targetColorProfile: "SRGB" } as const;

type TextureFakeGL = Pick<
  WebGLRenderingContext,
  "createTexture" | "bindTexture" | "texImage2D" | "texParameteri" | "pixelStorei" | "deleteTexture"
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
  readonly UNPACK_COLORSPACE_CONVERSION_WEBGL: number;
  readonly BROWSER_DEFAULT_WEBGL: number;
  readonly NONE: number;
};

function makeTextureFakeGL(): { readonly gl: WebGLRenderingContext; readonly calls: { uploads: number; deletes: number; pixelStores: readonly number[][] } } {
  const pixelStores: number[][] = [];
  const calls = { uploads: 0, deletes: 0, pixelStores };
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
    UNPACK_COLORSPACE_CONVERSION_WEBGL: 37443,
    BROWSER_DEFAULT_WEBGL: 37444,
    NONE: 0,
    createTexture: () => ({}) as WebGLTexture,
    bindTexture: () => undefined,
    texImage2D: () => {
      calls.uploads += 1;
    },
    texParameteri: () => undefined,
    pixelStorei: (pname: number, param: number) => {
      pixelStores.push([pname, param]);
    },
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

function installImageBitmapOptionStub(optionsRef: { readonly values: ImageBitmapOptions[] }): void {
  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true,
    value: (_blob: Blob, options?: ImageBitmapOptions) => {
      if (!options) {
        throw new Error("texture upload must pass explicit ImageBitmapOptions");
      }
      optionsRef.values.push(options);
      return Promise.resolve({
        width: 8,
        height: 6,
        close: () => undefined,
      } as ImageBitmap);
    },
  });
}

describe("createTextureCache", () => {
  beforeEach(() => {
    installImageBitmapStub();
  });

  it("deduplicates concurrent preparation for the same resource", async () => {
    const { gl, calls } = makeTextureFakeGL();
    const cache = createTextureCache(gl);
    const resource = imageTextureResource("shared", UNMANAGED);
    const data = new Uint8Array([1, 2, 3]);

    const [first, second] = await Promise.all([
      cache.prepare(resource, data, "image/png", { colorManagement: UNMANAGED }),
      cache.prepare(resource, data, "image/png", { colorManagement: UNMANAGED }),
    ]);

    expect(first).toBe(second);
    expect(first.refCount).toBe(1);
    expect(calls.uploads).toBe(1);
  });

  it("keeps prepared textures cached across repeated viewport prepares", async () => {
    const { gl, calls } = makeTextureFakeGL();
    const cache = createTextureCache(gl);
    const resource = imageTextureResource("cached", UNMANAGED);
    const data = new Uint8Array([1, 2, 3]);

    await cache.prepare(resource, data, "image/png", { colorManagement: UNMANAGED });
    await cache.prepare(resource, data, "image/png", { colorManagement: UNMANAGED });

    expect(calls.uploads).toBe(1);
    expect(cache.getIfCached(resource)?.width).toBe(8);
  });

  it("passes explicit color management into bitmap decode and WebGL upload", async () => {
    const optionsRef: { values: ImageBitmapOptions[] } = { values: [] };
    installImageBitmapOptionStub(optionsRef);
    const { gl, calls } = makeTextureFakeGL();
    const cache = createTextureCache(gl);
    const resource = imageTextureResource("managed", SRGB_MANAGED);
    const data = new Uint8Array([1, 2, 3]);

    await cache.prepare(resource, data, "image/png", { colorManagement: SRGB_MANAGED });

    expect(optionsRef.values).toEqual([{ colorSpaceConversion: "default" }]);
    expect(calls.pixelStores).toEqual([[37443, 37444]]);
  });

  it("keeps color management state explicit per upload", async () => {
    const optionsRef: { values: ImageBitmapOptions[] } = { values: [] };
    installImageBitmapOptionStub(optionsRef);
    const { gl, calls } = makeTextureFakeGL();
    const cache = createTextureCache(gl);
    const data = new Uint8Array([1, 2, 3]);

    await cache.prepare(imageTextureResource("raw", UNMANAGED), data, "image/png", { colorManagement: UNMANAGED });
    await cache.prepare(imageTextureResource("managed", SRGB_MANAGED), data, "image/png", { colorManagement: SRGB_MANAGED });

    expect(optionsRef.values).toEqual([
      { colorSpaceConversion: "none" },
      { colorSpaceConversion: "default" },
    ]);
    expect(calls.pixelStores).toEqual([
      [37443, 0],
      [37443, 37444],
    ]);
  });
});
