/**
 * @file WebGL renderer module — public API barrel.
 *
 * Provides GPU-accelerated rendering of Figma scene graphs. Internal layout:
 *
 * - `renderer/` — main composition (`createWebGLFigmaRenderer`)
 * - `tessellation/` — geometry: path contours, fills, strokes, stencil fans
 * - `text/` — text-node tessellation and visibility
 * - `fill/` — fill draw calls and per-path fill plan
 * - `effects/` — effect application and stencil clipping
 * - `resources/` — caches, textures, framebuffers, identity store
 * - `scene/` — scene state, render-tree cache, culling, surface, viewport,
 *   preparation status, render-tree contract audit
 * - `shaders/` — GLSL program sources and the shader cache
 * - `react/` — React lifecycle hook
 *
 * Sub-folders are not separate entry points: this barrel is the only one,
 * so consumers see a single coherent WebGL surface. The custom
 * `no-cross-package-reexport` rule forbids republishing primitives (e.g.
 * `flattenPathCommands` from `@higma-primitives/path`) through this barrel;
 * consumers must import them directly.
 */

// Main renderer
export {
  createWebGLFigmaRenderer,
  type WebGLFigmaRendererInstance,
  type WebGLRendererOptions,
  type WebGLFigmaRendererMetrics,
} from "./renderer/renderer";

// Resource context & identity
export {
  createWebGLFigmaResourceContext,
  type WebGLFigmaResourceContext,
} from "./resources/resource-context";
export {
  createWebGLSceneResourceIdentityStore,
  type WebGLSceneResourceIdentityStore,
  type WebGLSceneResourceKey,
} from "./resources/resource-identity";
export {
  createTextureCache,
  type TextureCache,
  type TextureEntry,
} from "./resources/texture-cache";
export {
  imageTextureResource,
  type TextureResource,
  type TextureResourceId,
  type ImageTextureResource,
} from "./resources/texture-resource";
export {
  createFramebuffer,
  deleteFramebuffer,
  bindFramebuffer,
  type Framebuffer,
} from "./resources/framebuffer";

// Tessellation
export {
  triangulate,
  tessellateContour,
  tessellateContours,
  generateRectVertices,
  generateEllipseVertices,
} from "./tessellation/tessellation";
export {
  tessellateRectStroke,
  tessellateEllipseStroke,
  tessellatePathStroke,
} from "./tessellation/stroke-tessellation";

// Shaders
export {
  createShaderCache,
  type ShaderCache,
  type ShaderProgramName,
} from "./shaders";

// Fill rendering
export {
  drawSolidFill,
  drawLinearGradientFill,
  drawRadialGradientFill,
  drawImageFill,
  type GLContext,
} from "./fill/fill-renderer";

// Text rendering
export { tessellateTextNode, type TessellatedText } from "./text/text-renderer";

// Effects & stencil clipping
export {
  createEffectsRenderer,
  type EffectsRendererInstance,
} from "./effects/effects-renderer";
export { beginStencilClip, endStencilClip } from "./effects/clip-mask";

// Scene state
export {
  createSceneState,
  type SceneStateInstance,
  type NodeGPUState,
} from "./scene/scene-state";

// Viewport backing-store policy
export {
  resolveWebGLViewportPixelRatio,
  type WebGLViewportPixelRatioInput,
} from "./scene/viewport-pixel-ratio";
