/**
 * @file CSS Font Loading API based font loader
 *
 * A CSS font loader that only checks font availability using the CSS Font
 * Loading API. Does not support path-based text rendering since it cannot
 * load font files.
 */

import type { FontLoader } from "../../font/loader";
import type { FontQuery } from "../../font/query";
import type { LoadedFont } from "../../font/types";

/**
 * Check if CSS Font Loading API is available
 */
export function isCssFontLoaderSupported(): boolean {
  return typeof document !== "undefined" && "fonts" in document;
}

/**
 * Create a CSS font loader
 *
 * This loader can only check font availability, not load font files.
 * Path-based text rendering (`renderTextNodeAsPath`) will not work
 * with this loader since it cannot provide font files.
 */
export function createCssFontLoader(): FontLoader {
  return {
    async loadFont(_query: FontQuery): Promise<LoadedFont | undefined> {
      // Cannot load font files with CSS Font Loading API
      return undefined;
    },

    async isFontAvailable(family: string): Promise<boolean> {
      if (!isCssFontLoaderSupported()) {
        return false;
      }

      // Use document.fonts.check() to test availability
      const testString = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
      return document.fonts.check(`16px "${family}"`, testString);
    },

    async listFontFamilies(): Promise<readonly string[]> {
      return [];
    },
  };
}
