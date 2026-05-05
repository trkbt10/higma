/** @file WebGL canvas surface sizing helpers. */

export type WebGLCanvasRenderSurface = {
  width: number;
  height: number;
  readonly style: {
    width: string;
    height: string;
  };
};

/** Synchronize canvas backing/CSS size without reallocating on unchanged viewport renders. */
export function syncWebGLCanvasRenderSurface({
  canvas,
  width,
  height,
  pixelRatio,
}: {
  readonly canvas: WebGLCanvasRenderSurface;
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
}): void {
  const backingWidth = Math.ceil(width * pixelRatio);
  const backingHeight = Math.ceil(height * pixelRatio);
  if (canvas.width !== backingWidth) {
    canvas.width = backingWidth;
  }
  if (canvas.height !== backingHeight) {
    canvas.height = backingHeight;
  }

  const cssWidth = `${width}px`;
  const cssHeight = `${height}px`;
  if (canvas.style.width !== cssWidth) {
    canvas.style.width = cssWidth;
  }
  if (canvas.style.height !== cssHeight) {
    canvas.style.height = cssHeight;
  }
}
