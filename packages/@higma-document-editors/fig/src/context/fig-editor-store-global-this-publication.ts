/** @file Non-React Fig editor store publication for globalThis consumers. */
import {
  createFigEditorStore,
  type FigEditorStore,
  type FigEditorStoreOptions,
} from "./fig-editor-store";
import { publishFigEditorOperationSurfaceOnGlobalThis } from "../operation-surface/fig-editor-global-this-operation-surface";

export type GlobalThisPublishedFigEditorStore = {
  readonly store: FigEditorStore;
  readonly dispose: () => void;
};

/** Create one Fig editor store and publish its store-owned operation surface on globalThis. */
export function createGlobalThisPublishedFigEditorStore(
  options: FigEditorStoreOptions,
): GlobalThisPublishedFigEditorStore {
  const store = createFigEditorStore(options);
  const unpublishOperationSurface = publishFigEditorOperationSurfaceOnGlobalThis(store.operationSurface);
  return {
    store,
    dispose: () => {
      unpublishOperationSurface();
      store.dispose();
    },
  };
}
