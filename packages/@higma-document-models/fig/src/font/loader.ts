/**
 * @file Font loader interface for DI pattern.
 *
 * Provides an abstraction for loading font files in different environments.
 * Node.js can load from filesystem, browsers can use Local Font Access API.
 *
 * The query argument is the canonical `FontQuery` — concrete (non-optional)
 * `weight` and `style`. Driver implementations resolve the closest available
 * variant; the returned `LoadedFont.query` reports what they actually loaded.
 */

import type { FontQuery } from "./query";
import type { LoadedFont } from "./types";

/**
 * Font loader interface.
 *
 * Implement this interface to provide font loading in your environment.
 * - Node.js: Load from filesystem (system fonts or bundled fonts)
 * - Browser: Load from Local Font Access API or bundled fonts
 */
export type FontLoader = {
  /**
   * Load a font matching the given query.
   *
   * @returns Loaded font or undefined if not found.
   */
  loadFont(query: FontQuery): Promise<LoadedFont | undefined>;

  /** Check if a font family is available. */
  isFontAvailable(family: string): Promise<boolean>;

  /** List available font families. */
  listFontFamilies?(): Promise<readonly string[]>;
};
