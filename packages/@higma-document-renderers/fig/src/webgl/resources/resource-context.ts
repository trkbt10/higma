/** @file Central WebGL resource context for fig rendering. */

import { createShaderCache, type ShaderCache } from "../shaders";
import { createTextureCache, type TextureCache } from "./texture-cache";
import { createWebGLRenderTreeCache, type WebGLRenderTreeCache } from "../scene/render-tree-cache";
import { createWebGLSceneResourceIdentityStore, type WebGLSceneResourceIdentityStore } from "./resource-identity";

export type WebGLFigmaResourceContext = {
  readonly shaders: ShaderCache;
  readonly textures: TextureCache;
  readonly renderTrees: WebGLRenderTreeCache;
  readonly sceneResources: WebGLSceneResourceIdentityStore;
  readonly precompile: () => void;
  readonly dispose: () => void;
};

/** Create the single owner for shader, texture, and render-tree resources. */
export function createWebGLFigmaResourceContext(gl: WebGLRenderingContext): WebGLFigmaResourceContext {
  const shaders = createShaderCache(gl);
  const textures = createTextureCache(gl);
  const sceneResources = createWebGLSceneResourceIdentityStore();
  const renderTrees = createWebGLRenderTreeCache(sceneResources);

  return {
    shaders,
    textures,
    renderTrees,
    sceneResources,
    precompile(): void {
      shaders.precompileAll();
    },
    dispose(): void {
      shaders.dispose();
      textures.dispose();
      renderTrees.clear();
    },
  };
}
