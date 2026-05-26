/** @file Central WebGL resource context for fig rendering. */

import { createShaderCache, type ShaderCache } from "../shaders";
import { createTextureCache, type TextureCache } from "./texture-cache";
import { createWebGLVertexBufferCache, type WebGLVertexBufferCache } from "./vertex-buffer-cache";
import { createWebGLRenderTreeCache, type WebGLRenderTreeCache } from "../scene/render-tree-cache";

export type WebGLFigmaResourceContext = {
  readonly shaders: ShaderCache;
  readonly textures: TextureCache;
  readonly vertexBuffers: WebGLVertexBufferCache;
  readonly renderTrees: WebGLRenderTreeCache;
  readonly precompile: () => void;
  readonly dispose: () => void;
};

/** Create the single owner for shader, texture, and render-tree resources. */
export function createWebGLFigmaResourceContext(gl: WebGLRenderingContext): WebGLFigmaResourceContext {
  const shaders = createShaderCache(gl);
  const textures = createTextureCache(gl);
  const vertexBuffers = createWebGLVertexBufferCache(gl);
  const renderTrees = createWebGLRenderTreeCache();

  return {
    shaders,
    textures,
    vertexBuffers,
    renderTrees,
    precompile(): void {
      shaders.precompileAll();
    },
    dispose(): void {
      shaders.dispose();
      textures.dispose();
      vertexBuffers.dispose();
      renderTrees.clear();
    },
  };
}
