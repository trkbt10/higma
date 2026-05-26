/**
 * @file Browser font drivers
 *
 * Provides font loading for browser environments using:
 * - Local Font Access API (preferred, requires permission)
 * - CSS Font Loading API (availability check only)
 */

export {
  createBrowserFontLoader,
  isBrowserFontLoaderSupported,
  type BrowserFontLoaderGlobalThisHost,
} from "./browser-loader";
export {
  createCssFontLoader,
  isCssFontLoaderSupported,
  type CssFontLoaderGlobalThisHost,
} from "./css-font-loader";
