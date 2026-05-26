/** @file WebGL renderer — public API for GPU-accelerated Figma scene graph rendering. */

// Main renderer
export {
  createWebGLFigmaRenderer,
  type WebGLFigmaRendererInstance,
  type WebGLRendererOptions,
  type WebGLFigmaRendererMetrics,
  type WebGLRenderFrameOptions,
  type WebGLRenderFrameReason,
} from "./renderer/renderer";

// Resource context and source document reference keys
export {
  createWebGLFigmaResourceContext,
  type WebGLFigmaResourceContext,
} from "./resources/resource-context";
export {
  areWebGLSceneResourceReferenceKeysEqual,
  createWebGLSceneResourceReferenceKey,
  type WebGLSceneResourceReferenceKey,
} from "./resources/scene-resource-reference-key";
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

// Viewport backing-store policy
export {
  resolveWebGLViewportPixelRatio,
  type WebGLViewportPixelRatioInput,
} from "./scene/viewport-pixel-ratio";
export {
  getWebGLViewportPreparationStatus,
  type WebGLViewportPreparationStatus,
} from "./scene/preparation-status";
export {
  createWebGLViewportRendererGlobalThisScheduler,
  createWebGLViewportRendererController,
  getInitialWebGLViewportRendererControllerSnapshot,
  hasWebGLViewportRendererGlobalThisSchedulerHost,
  resolveWebGLViewportRenderSchedulingDecision,
  shouldNotifyWebGLViewportRendererSubscribers,
  type WebGLViewportRendererGlobalThisSchedulerHost,
  type WebGLViewportRendererController,
  type WebGLViewportRendererControllerInput,
  type WebGLViewportRendererControllerSnapshot,
  type WebGLViewportSceneViewport,
  type WebGLViewportRenderSchedulingDecision,
  type WebGLViewportRenderSchedulingInput,
  type WebGLViewportRendererScheduler,
} from "./viewport/webgl-viewport-renderer-controller";
