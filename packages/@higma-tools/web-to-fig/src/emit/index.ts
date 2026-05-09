/**
 * @file Public entry — IR → Fig emission surface.
 */
export type { BuildDocumentResult } from "./build-document";
export { buildDocument } from "./build-document";

export type { SpecGraph } from "./ir-to-spec";
export { irToSpecGraph } from "./ir-to-spec";

export { buildFigFileBytes } from "./build-fig-file";

export type { MultiFigBuildResult } from "./build-multi-fig";
export { buildMultiFigFileBytes } from "./build-multi-fig";

export type { EmitFigOptions, EmitFigResult } from "./export-fig";
export { emitFig } from "./export-fig";
