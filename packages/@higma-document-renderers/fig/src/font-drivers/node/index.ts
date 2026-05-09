/**
 * @file Node.js font driver
 *
 * OS-correct font resolution. Each platform consults its own canonical
 * source (CoreText dirs on darwin, fontconfig on linux, the Fonts
 * registry on win32) — see `node-loader.ts` for details.
 */

export {
  createNodeFontLoader,
  createNodeFontLoaderWithEnv,
  createNodeFontLoaderWithFontsource,
  type CreateNodeFontLoaderOptions,
  type NodeFontLoaderEnv,
  type NodeFontLoaderInstance,
} from "./node-loader";

export type {
  DiscoveredFontFile,
  DiscoveryEnv,
  DiscoveryExec,
  DiscoveryFs,
  DiscoveryResult,
  DiscoverySource,
} from "./discover-types";
