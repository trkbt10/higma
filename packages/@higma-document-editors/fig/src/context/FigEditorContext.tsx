/**
 * @file React context binding for the Kiwi-backed Fig editor store.
 */
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  type FigEditorCanvasViewportSnapshot,
  type FigEditorContextValue,
  type FigEditorSelectedFigNodeDragTransform,
  type FigEditorStore,
} from "./fig-editor-store";
import type { FigEditorOperationSurface } from "../operation-surface/fig-editor-operation-surface-types";

export {
  createFigEditorStore,
  FIG_NODE_MUTATION_SOURCE,
} from "./fig-editor-store";

export type {
  FigCreationMode,
  FigEditorCanvasNodeBoundsSnapshot,
  FigEditorCanvasViewportSnapshot,
  FigEditorContextValue,
  FigEditorKiwiDocumentMutation,
  FigEditorKiwiDocumentMutationScope,
  FigEditorKiwiDocumentMutationSource,
  FigEditorSelectedFigNodeDragTransform,
  FigEditorStore,
  FigTextEditState,
  FigNodeMutationSource,
  SelectNodeOptions,
} from "./fig-editor-store";

export type FigEditorStoreProviderProps = {
  readonly store: FigEditorStore;
  readonly children: ReactNode;
};

export type FigEditorContextSelector<T> = (editor: FigEditorContextValue) => T;
export type FigEditorContextSelectionEquality<T> = (left: T, right: T) => boolean;

type FigEditorContextSelectionCache<T> = {
  readonly source: FigEditorContextValue;
  readonly selection: T;
};

const FigEditorStoreContext = createContext<FigEditorStore | null>(null);

function useRequiredFigEditorStore(owner: string): FigEditorStore {
  const store = useContext(FigEditorStoreContext);
  if (store === null) {
    throw new Error(`${owner} must be used within FigEditorStoreProvider`);
  }
  return store;
}

function useFigEditorStoreSnapshotOptional(store: FigEditorStore | null): FigEditorContextValue | null {
  const subscribe = useCallback((listener: () => void) => {
    if (store === null) {
      return () => undefined;
    }
    return store.subscribe(listener);
  }, [store]);
  const getSnapshot = useCallback(() => {
    if (store === null) {
      return null;
    }
    return store.getSnapshot();
  }, [store]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function selectedFigEditorSnapshot<T>({
  store,
  selector,
  isEqual,
  cache,
}: {
  readonly store: FigEditorStore;
  readonly selector: FigEditorContextSelector<T>;
  readonly isEqual: FigEditorContextSelectionEquality<T>;
  readonly cache: { current: FigEditorContextSelectionCache<T> | null };
}): T {
  const source = store.getSnapshot();
  const current = cache.current;
  if (current !== null && current.source === source) {
    return current.selection;
  }
  const selection = selector(source);
  if (current !== null && isEqual(current.selection, selection)) {
    cache.current = { source, selection: current.selection };
    return current.selection;
  }
  cache.current = { source, selection };
  return selection;
}

function useFigEditorSelectedFigNodeDragTransformSnapshot(
  store: FigEditorStore,
): FigEditorSelectedFigNodeDragTransform | null {
  return useSyncExternalStore(
    store.subscribeSelectedFigNodeDragTransform,
    store.getSelectedFigNodeDragTransformSnapshot,
    store.getSelectedFigNodeDragTransformSnapshot,
  );
}

function useFigEditorCanvasViewportSnapshot(
  store: FigEditorStore,
): FigEditorCanvasViewportSnapshot | undefined {
  return useSyncExternalStore(
    store.subscribeCanvasViewport,
    store.getCanvasViewportSnapshot,
    store.getCanvasViewportSnapshot,
  );
}

/**
 * Provide an existing UI-library-independent Fig editor store to React consumers.
 */
export function FigEditorStoreProvider({
  store,
  children,
}: FigEditorStoreProviderProps) {
  return (
    <FigEditorStoreContext.Provider value={store}>
      {children}
    </FigEditorStoreContext.Provider>
  );
}

/**
 * Read the required Fig editor context.
 */
export function useFigEditor(): FigEditorContextValue {
  const editor = useFigEditorStoreSnapshotOptional(useContext(FigEditorStoreContext));
  if (editor === null) {
    throw new Error("useFigEditor must be used within FigEditorStoreProvider");
  }
  return editor;
}

/** Read a stable selection from the Fig editor store. */
export function useFigEditorSelector<T>(
  selector: FigEditorContextSelector<T>,
  isEqual: FigEditorContextSelectionEquality<T> = Object.is,
): T {
  const store = useRequiredFigEditorStore("useFigEditorSelector");
  const cache = useRef<FigEditorContextSelectionCache<T> | null>(null);
  const getSnapshot = useCallback(
    () => selectedFigEditorSnapshot({ store, selector, isEqual, cache }),
    [store, selector, isEqual],
  );
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/** Read the current Fig editor snapshot at command execution time without subscribing the caller. */
export function useFigEditorSnapshotReader(): () => FigEditorContextValue {
  const store = useRequiredFigEditorStore("useFigEditorSnapshotReader");
  return store.getSnapshot;
}

/** Read the store-owned operation surface used by non-DOM automation and ESM consumers. */
export function useFigEditorOperationSurface(): FigEditorOperationSurface {
  return useRequiredFigEditorStore("useFigEditorOperationSurface").operationSurface;
}

/** Read only the high-frequency selected FigNode drag transform operation snapshot. */
export function useFigEditorSelectedFigNodeDragTransform(): FigEditorSelectedFigNodeDragTransform | null {
  const store = useRequiredFigEditorStore("useFigEditorSelectedFigNodeDragTransform");
  return useFigEditorSelectedFigNodeDragTransformSnapshot(store);
}

/** Read only the high-frequency Fig editor canvas viewport snapshot. */
export function useFigEditorCanvasViewport(): FigEditorCanvasViewportSnapshot | undefined {
  const store = useRequiredFigEditorStore("useFigEditorCanvasViewport");
  return useFigEditorCanvasViewportSnapshot(store);
}

/**
 * Read the Fig editor context when the caller may be outside the provider.
 */
export function useFigEditorOptional(): FigEditorContextValue | null {
  return useFigEditorStoreSnapshotOptional(useContext(FigEditorStoreContext));
}
