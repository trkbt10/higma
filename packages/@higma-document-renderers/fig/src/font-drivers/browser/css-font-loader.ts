/**
 * @file CSS Font Loading API based font loader
 *
 * A CSS font loader that only checks font availability using the CSS Font
 * Loading API. Does not support path-based text rendering since it cannot
 * load font files.
 */

import type { FontLoader } from "@higma-document-models/fig/font";
import type { FontQuery } from "@higma-document-models/fig/font";
import type { LoadedFont } from "@higma-document-models/fig/font";

export type CssFontLoaderGlobalThisHost = {
  readonly document?: {
    readonly fonts?: {
      check(font: string, text?: string): boolean;
    };
  };
};

/**
 * Check if CSS Font Loading API is available
 */
export function isCssFontLoaderSupported(host: CssFontLoaderGlobalThisHost): boolean {
  return host.document?.fonts !== undefined;
}

function requireCssFontLoaderFonts(host: CssFontLoaderGlobalThisHost) {
  const fonts = host.document?.fonts;
  if (fonts === undefined) {
    throw new Error("CSS font loader requires host.document.fonts");
  }
  return fonts;
}

/**
 * Create a CSS font loader
 *
 * This loader can only check font availability, not load font files.
 * Path-based text rendering (`renderTextNodeAsPath`) will not work
 * with this loader since it cannot provide font files.
 */
export function createCssFontLoader(host: CssFontLoaderGlobalThisHost): FontLoader {
  const fonts = requireCssFontLoaderFonts(host);
  return {
    async loadFont(_query: FontQuery): Promise<LoadedFont | undefined> {
      // Cannot load font files with CSS Font Loading API
      return undefined;
    },

    async isFontAvailable(family: string): Promise<boolean> {
      const testString = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
      return fonts.check(`16px "${family}"`, testString);
    },

    async listFontFamilies(): Promise<readonly string[]> {
      return [];
    },
  };
}
