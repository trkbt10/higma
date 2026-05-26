/** @file WebGL texture resource key tests. */

import { imageTextureResource } from "./texture-resource";

const UNMANAGED = { kind: "unmanaged" } as const;
const SRGB_MANAGED = { kind: "managed", targetColorProfile: "SRGB" } as const;
const P3_MANAGED = { kind: "managed", targetColorProfile: "DISPLAY_P3_V4" } as const;

describe("imageTextureResource", () => {
  it("namespaces image references into texture resource ids", () => {
    const resource = imageTextureResource("abc123", UNMANAGED);

    expect(resource.kind).toBe("image");
    expect(resource.id).toBe("image:abc123:color:unmanaged");
    expect(resource.imageHash).toBe("abc123");
  });

  it("rejects empty image references", () => {
    expect(() => imageTextureResource("", UNMANAGED)).toThrow("imageTextureResource requires a non-empty image hash");
  });

  it("separates explicit color management variants", () => {
    expect(imageTextureResource("abc123", UNMANAGED).id).toBe("image:abc123:color:unmanaged");
    expect(imageTextureResource("abc123", SRGB_MANAGED).id).toBe("image:abc123:color-managed:SRGB");
    expect(imageTextureResource("abc123", P3_MANAGED).id).toBe("image:abc123:color-managed:DISPLAY_P3_V4");
  });
});
