/** @file Browser font access boundary for dev Fig rendering/editing. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { figDocumentResources, type FigDocumentContext } from "@higma-document-io/fig";
import { collectFontQueries, createCachingFontLoader, fontQueryKey, preloadFonts, type FontQuery } from "@higma-document-models/fig/font";
import { createBrowserFontLoader, isBrowserFontLoaderSupported } from "@higma-document-renderers/fig/font-drivers/browser";
import { createCachedTextFontResolver, type TextFontResolver } from "@higma-document-renderers/fig/text";

const browserFontLoader = createBrowserFontLoader();
const fontLoader = createCachingFontLoader(browserFontLoader);

export type BrowserTextFontResolverState = {
  readonly supported: boolean;
  readonly granted: boolean;
  readonly ready: boolean;
  readonly resolver: TextFontResolver | undefined;
  readonly requestAccess: () => void;
};

type BrowserTextFontPreloadState = {
  readonly key: string;
  readonly ready: boolean;
};

function collectContextFontQueries(context: FigDocumentContext) {
  const resources = figDocumentResources(context);
  return collectFontQueries({
    roots: context.document.nodeChanges,
    symbolResolver: context.symbolResolver,
    childrenOf: resources.childrenOf,
  }).fontResolverQueries;
}

function toError(reason: unknown): Error {
  if (reason instanceof Error) {
    return reason;
  }
  return new Error(`Browser font resolver failed with non-Error reason: ${String(reason)}`);
}

function fontPreloadKey(queries: readonly FontQuery[]): string {
  return queries.map(fontQueryKey).join("\n");
}

/** Create the dev text font resolver from browser-local fonts declared by the Kiwi document. */
export function useBrowserTextFontResolver(context: FigDocumentContext): BrowserTextFontResolverState {
  const [supported] = useState(() => isBrowserFontLoaderSupported());
  const [granted, setGranted] = useState(() => browserFontLoader.hasPermission());
  const [error, setError] = useState<Error | null>(null);
  const queries = useMemo(() => {
    if (!granted) {
      return [];
    }
    return collectContextFontQueries(context);
  }, [context, granted]);
  const preloadKey = useMemo(() => fontPreloadKey(queries), [queries]);
  const [preloadState, setPreloadState] = useState<BrowserTextFontPreloadState>(() => ({
    key: preloadKey,
    ready: !granted,
  }));
  const ready = !granted || (preloadState.key === preloadKey && preloadState.ready);

  useEffect(() => {
    if (!granted) {
      setPreloadState({ key: preloadKey, ready: true });
      setError(null);
      return;
    }

    const cancelled = { value: false };
    setPreloadState({ key: preloadKey, ready: false });
    setError(null);
    void preloadFonts({ queries, loader: fontLoader }).then(
      () => {
        if (cancelled.value) {
          return;
        }
        setPreloadState({ key: preloadKey, ready: true });
      },
      (reason: unknown) => {
        if (cancelled.value) {
          return;
        }
        setError(toError(reason));
      },
    );
    return () => {
      cancelled.value = true;
    };
  }, [granted, preloadKey, queries]);

  const requestAccess = useCallback((): void => {
    const run = async (): Promise<void> => {
      await fontLoader.listFontFamilies();
      if (!browserFontLoader.hasPermission()) {
        throw new Error("Browser font access was requested but permission was not granted");
      }
      setGranted(true);
    };
    void run().catch((reason: unknown) => setError(toError(reason)));
  }, []);

  if (error !== null) {
    throw error;
  }

  const resolver = useMemo<TextFontResolver | undefined>(() => {
    if (!ready) {
      return undefined;
    }
    return createCachedTextFontResolver(fontLoader);
  }, [ready]);

  return {
    supported,
    granted,
    ready,
    resolver,
    requestAccess,
  };
}
