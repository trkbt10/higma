/** @file WebGL renderer context attribute tests. */
import { resolveWebGLRendererContextAttributes, type WebGLRendererOptions } from "./renderer";

function options(overrides: Partial<WebGLRendererOptions> = {}): WebGLRendererOptions {
  return {
    canvas: {} as HTMLCanvasElement,
    ...overrides,
  };
}

describe("resolveWebGLRendererContextAttributes", () => {
  it("does not preserve the drawing buffer for interactive viewport rendering by default", () => {
    expect(resolveWebGLRendererContextAttributes(options()).preserveDrawingBuffer).toBe(false);
  });

  it("preserves the drawing buffer only when the caller explicitly requests readback semantics", () => {
    expect(resolveWebGLRendererContextAttributes(options({ preserveDrawingBuffer: true })).preserveDrawingBuffer).toBe(true);
  });
});
