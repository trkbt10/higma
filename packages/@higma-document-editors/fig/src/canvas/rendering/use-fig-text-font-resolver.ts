/** @file Editor bridge for preloaded text font resolution. */
import { useMemo } from "react";
import type { FigNode } from "@higma-document-models/fig/types";
import type { CachingFontLoader } from "@higma-document-models/fig/font";
import { createCachedTextFontResolver, type TextFontResolver } from "@higma-document-renderers/fig/text";

export type UseFigTextFontResolverOptions = {
  readonly page: FigNode | undefined;
  readonly fontLoader?: CachingFontLoader;
};

/** Return the explicit font resolver supplied to the editor, if present. */
export function useFigTextFontResolver({
  page,
  fontLoader,
}: UseFigTextFontResolverOptions): TextFontResolver | undefined {
  return useMemo<TextFontResolver | undefined>(() => {
    if (page === undefined || fontLoader === undefined) {
      return undefined;
    }
    return createCachedTextFontResolver(fontLoader);
  }, [fontLoader, page]);
}
