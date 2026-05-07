/**
 * @file Rasterise an SVG string into a PNG/JPEG blob via the browser
 * canvas pipeline.
 *
 * The conversion goes SVG-string → blob URL → `<img>.decode()` →
 * canvas `drawImage` → `toBlob`. JPEG renders on a white background
 * since `image/jpeg` cannot encode alpha; PNG keeps the original
 * transparency.
 *
 * `Image.decode()` is required (rather than `await image.onload`)
 * because Safari/WebKit fires `load` before image data is fully
 * decoded for SVG sources, producing blank canvases. `decode()`
 * resolves only after the image is paint-ready.
 */

export type RasterFormat = "PNG" | "JPEG";

export type RasterizeArgs = {
  readonly svgString: string;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly format: RasterFormat;
  /** Background color used to flatten alpha for JPEG. */
  readonly jpegBackground?: string;
};






export async function rasterizeSvg(args: RasterizeArgs): Promise<Blob> {
  const targetWidth = Math.max(1, Math.round(args.width * args.scale));
  const targetHeight = Math.max(1, Math.round(args.height * args.scale));

  const svgBlob = new Blob([args.svgString], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);
  try {
    const image = new Image();
    image.src = svgUrl;
    image.crossOrigin = "anonymous";
    // `decode()` waits until the image is paintable; `onload` does not.
    await image.decode();

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("2D canvas context unavailable in this webview");
    }
    if (args.format === "JPEG") {
      ctx.fillStyle = args.jpegBackground ?? "#ffffff";
      ctx.fillRect(0, 0, targetWidth, targetHeight);
    }
    ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

    const mime = args.format === "PNG" ? "image/png" : "image/jpeg";
    const quality = args.format === "JPEG" ? 0.92 : undefined;
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("canvas.toBlob produced null"));
          }
        },
        mime,
        quality,
      );
    });
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}
