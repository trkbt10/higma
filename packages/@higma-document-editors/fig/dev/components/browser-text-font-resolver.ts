/** @file Browser font access boundary for dev Fig rendering/editing. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { figDocumentResources, type FigDocumentContext } from "@higma-document-io/fig";
import { collectFontQueries, createCachingFontLoader, preloadFonts } from "@higma-document-models/fig/font";
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

function collectContextFontQueries(context: FigDocumentContext) {
  const resources = figDocumentResources(context);
  return collectFontQueries({
    roots: context.document.nodeChanges,
    symbolResolver: context.symbolResolver,
    childrenOf: resources.childrenOf,
  }).queries;
}

function toError(reason: unknown): Error {
  if (reason instanceof Error) {
    return reason;
  }
  return new Error(`Browser font resolver failed with non-Error reason: ${String(reason)}`);
}

/** Create the dev text font resolver from browser-local fonts declared by the Kiwi document. */
export function useBrowserTextFontResolver(context: FigDocumentContext): BrowserTextFontResolverState {
  const [supported] = useState(() => isBrowserFontLoaderSupported());
  const [granted, setGranted] = useState(() => browserFontLoader.hasPermission());
  const [ready, setReady] = useState(() => browserFontLoader.hasPermission());
  const [error, setError] = useState<Error | null>(null);
  const queries = useMemo(() => {
    if (!granted) {
      return [];
    }
    return collectContextFontQueries(context);
  }, [context, granted]);

  useEffect(() => {
    if (!granted) {
      setReady(false);
      setError(null);
      return;
    }

    const cancelled = { value: false };
    setReady(false);
    setError(null);
    void preloadFonts({ queries, loader: fontLoader }).then(
      () => {
        if (cancelled.value) {
          return;
        }
        setReady(true);
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
  }, [granted, queries]);

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
