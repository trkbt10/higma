/** @file Renderer-facing resource view over FigDocumentContext. */

import type {
  FigBlob,
  FigKiwiDocumentIndex,
  FigStyleRegistry,
} from "@higma-document-models/fig/domain";
import type { FigPackageImage } from "@higma-figma-containers/package";
import type { SymbolResolver } from "@higma-document-models/fig/symbols";
import type { FigDocumentContext } from "./document-context";

export type FigDocumentResources = {
  readonly document: FigKiwiDocumentIndex;
  readonly childrenOf: FigKiwiDocumentIndex["childrenOf"];
  readonly symbolResolver: SymbolResolver;
  readonly styleRegistry: FigStyleRegistry;
  readonly blobs: readonly FigBlob[];
  readonly images: ReadonlyMap<string, FigPackageImage>;
};

/**
 * Project a document context into the renderer-facing resource bundle.
 */
export function figDocumentResources(ctx: FigDocumentContext): FigDocumentResources {
  return {
    document: ctx.document,
    childrenOf: ctx.document.childrenOf,
    symbolResolver: ctx.symbolResolver,
    styleRegistry: ctx.styleRegistry,
    blobs: ctx.blobs,
    images: ctx.images,
  };
}
