/** @file Fig Kiwi document domain entry point. */

export type {
  FigStyleRegistry,
  FigTextStyleProperties,
} from "./style-registry";
export type {
  LoadedFigFile,
  FigMessageHeader,
  FigMessageType,
  FigMessageTypeName,
  CreateNodeChangesMessageHeaderOptions,
} from "./roundtrip-state";
export {
  createNodeChangesMessageHeader,
  assertNodeChangesMessageHeader,
} from "./roundtrip-state";
export type { FigKiwiDocumentIndex } from "./kiwi-document-index";
export type { FigBlob } from "./blob-path";
// `PathCommand` and `SvgPathOptions` live in `@higma-primitives/path`.
// Consumers must import them directly from that package — the
// `no-cross-package-reexport` rule forbids republishing them here.

export {
  DEFAULT_PAGE_BACKGROUND,
} from "./page-background";

export {
  EMPTY_FIG_STYLE_REGISTRY,
} from "./style-registry";

export {
  guidToString,
  isFigGuid,
} from "./fig-guid";

export {
  figImageHashBytesToHex,
  figImageHashHexToBytes,
} from "./image-hash";

export {
  getNodeType,
} from "./kiwi-node";

export {
  sameKiwiNodeExceptTransform,
} from "./kiwi-node-transform-change";

export {
  resolveFigComponentPropDef,
  type FigComponentPropertyTypeName,
  type ResolvedFigComponentPropDef,
  type ResolveFigComponentPropDefOptions,
} from "./component-property-definition";

export {
  figKiwiTextDataStyleIDsMatchCharacters,
  writeFigKiwiTextDataCharacters,
} from "./kiwi-text-data";

export {
  derivedTextDataHasVisualPayload,
  derivedTextDataWithoutVisualPayload,
} from "./derived-text-data";

export {
  indexFigKiwiDocument,
  findNodesByType,
  findNodeByGuid,
} from "./kiwi-document-index";

export {
  decodePathCommands,
  decodeBlobToSvgPath,
} from "./blob-path";
// `pathCommandsToSvgPath` lives in `@higma-primitives/path`.
