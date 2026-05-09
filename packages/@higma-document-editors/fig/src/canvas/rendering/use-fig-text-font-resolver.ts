/** @file Explicit text font preloading for renderer-neutral glyph outlines. */

import { useEffect, useMemo, useState } from "react";
import type { FigPage } from "@higma-document-models/fig/domain";
import {
  collectFontQueries,
  fontQueryKey,
  type FontQuery,
} from "@higma-document-models/fig/font";
import { createCachedTextFontResolver, type TextFontResolver } from "@higma-document-renderers/fig/text";
import type { CachingFontLoader } from "@higma-document-models/fig/font";

export type UseFigTextFontResolverParams = {
  readonly page: FigPage | null | undefined;
  readonly fontLoader: CachingFontLoader | undefined;
};

/**
 * Walk the page's TEXT subtrees through the canonical
 * `collectFontQueries` SoT and surface the deduplicated `FontQuery`
 * list. The hook itself owns no detection logic — all weight / style
 * normalisation lives in the SoT, so cache keys, override fonts, and
 * INSTANCE-resolved SYMBOL bodies all share one interpretation.
 */
function pageFontQueries(page: FigPage | null | undefined): readonly FontQuery[] {
  if (!page) {
    return [];
  }
  const { queries } = collectFontQueries({ roots: page.children });
  return queries;
}

/** Preload fonts and expose a synchronous resolver for SceneGraph construction. */
export function useFigTextFontResolver({
  page,
  fontLoader,
}: UseFigTextFontResolverParams): TextFontResolver | undefined {
  const fontQueries = useMemo(() => pageFontQueries(page), [page]);
  const [loadedVersion, setLoadedVersion] = useState(0);
  const [loadedKey, setLoadedKey] = useState("");
  const requiredKey = useMemo(
    () => fontQueries.map(fontQueryKey).sort().join(""),
    [fontQueries],
  );

  useEffect(() => {
    if (!fontLoader || fontQueries.length === 0) {
      setLoadedKey("");
      return;
    }
    const cancelledRef = { value: false };
    void Promise.all(fontQueries.map(async (query) => {
      await fontLoader.loadFont(query);
    })).then(() => {
      if (!cancelledRef.value) {
        setLoadedKey(requiredKey);
        setLoadedVersion((version) => version + 1);
      }
    });
    return () => {
      cancelledRef.value = true;
    };
  }, [fontLoader, fontQueries, requiredKey]);

  return useMemo(() => {
    if (!fontLoader) {
      return undefined;
    }
    if (fontQueries.length > 0 && loadedKey !== requiredKey) {
      return undefined;
    }
    return createCachedTextFontResolver(fontLoader);
  }, [fontLoader, fontQueries.length, loadedKey, requiredKey, loadedVersion]);
}
