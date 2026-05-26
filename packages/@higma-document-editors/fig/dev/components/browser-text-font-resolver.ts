/** @file Browser font access boundary for dev Fig rendering/editing. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { figDocumentResources, type FigDocumentContext } from "@higma-document-io/fig";
import {
  collectFontQueries,
  createCachingFontLoader,
  detectBrowserFontPlatform,
  fontQueryKey,
  preloadFonts,
  type FontQuery,
} from "@higma-document-models/fig/font";
import { createBrowserFontLoader, isBrowserFontLoaderSupported } from "@higma-document-renderers/fig/font-drivers/browser";
import { createCachedTextFontResolver, type TextFontResolver } from "@higma-document-renderers/fig/text";

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

function createBrowserTextFontLoaderRuntime() {
  const browserFontLoader = createBrowserFontLoader({
    host: globalThis,
    platform: detectBrowserFontPlatform(globalThis),
  });
  return {
    browserFontLoader,
    fontLoader: createCachingFontLoader(browserFontLoader),
  };
}

function collectContextFontQueries(context: FigDocumentContext) {
  const resources = figDocumentResources(context);
  return collectFontQueries({
    roots: context.document.nodeChanges,
    symbolResolver: context.symbolResolver,
    childrenOf: resources.childrenOf,
  }).textLayoutFontResolverQueries;
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
  const [supported] = useState(() => isBrowserFontLoaderSupported(globalThis));
  const runtime = useMemo(() => {
    if (!supported) {
      return undefined;
    }
    return createBrowserTextFontLoaderRuntime();
  }, [supported]);
  const [granted, setGranted] = useState(() => runtime?.browserFontLoader.hasPermission() ?? false);
  const [error, setError] = useState<Error | null>(null);
  const queries = useMemo(() => {
    if (!granted) {
      return [];
    }
    return collectContextFontQueries(context);
  }, [context, granted]);
  const queriesRef = useRef(queries);
  queriesRef.current = queries;
  const preloadKey = useMemo(() => fontPreloadKey(queries), [queries]);
  const loadedPreloadKeyRef = useRef<string | null>(granted ? null : preloadKey);
  const [preloadState, setPreloadState] = useState<BrowserTextFontPreloadState>(() => ({
    key: preloadKey,
    ready: !granted,
  }));
  const ready = !granted || (preloadState.key === preloadKey && preloadState.ready);

  useEffect(() => {
    if (!granted) {
      loadedPreloadKeyRef.current = preloadKey;
      setPreloadState({ key: preloadKey, ready: true });
      setError(null);
      return;
    }
    if (loadedPreloadKeyRef.current === preloadKey) {
      setPreloadState((previous) => {
        if (previous.key === preloadKey && previous.ready) {
          return previous;
        }
        return { key: preloadKey, ready: true };
      });
      setError(null);
      return;
    }

    const cancelled = { value: false };
    if (runtime === undefined) {
      setError(new Error("Browser font resolver requires Local Font Access support before preloading"));
      return;
    }
    setPreloadState((previous) => {
      if (previous.key === preloadKey && !previous.ready) {
        return previous;
      }
      return { key: preloadKey, ready: false };
    });
    setError(null);
    void preloadFonts({ queries: queriesRef.current, loader: runtime.fontLoader }).then(
      () => {
        if (cancelled.value) {
          return;
        }
        loadedPreloadKeyRef.current = preloadKey;
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
  }, [granted, preloadKey, runtime]);

  const requestAccess = useCallback((): void => {
    const run = async (): Promise<void> => {
      if (runtime === undefined) {
        throw new Error("Browser font resolver requires Local Font Access support before requesting fonts");
      }
      await runtime.fontLoader.listFontFamilies();
      if (!runtime.browserFontLoader.hasPermission()) {
        throw new Error("Browser font access was requested but permission was not granted");
      }
      setGranted(true);
    };
    void run().catch((reason: unknown) => setError(toError(reason)));
  }, [runtime]);

  if (error !== null) {
    throw error;
  }

  const resolver = useMemo<TextFontResolver | undefined>(() => {
    if (!ready) {
      return undefined;
    }
    if (runtime === undefined) {
      return undefined;
    }
    return createCachedTextFontResolver(runtime.fontLoader);
  }, [ready, runtime]);

  return {
    supported,
    granted,
    ready,
    resolver,
    requestAccess,
  };
}
