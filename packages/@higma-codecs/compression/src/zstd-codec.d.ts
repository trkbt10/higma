declare module "zstd-codec" {
  export type ZstdSimple = {
    compress(data: Uint8Array, level?: number): Uint8Array | null;
  };

  export const ZstdCodec: {
    run(callback: (binding: { readonly Simple: new () => ZstdSimple }) => void): void;
  };
}
