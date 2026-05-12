/**
 * @file Types barrel — io-specific NodeSpec discriminated union.
 *
 * Domain types (FigDesignDocument, FigDesignNode, FigPage, FigNodeId,
 * FigPageId, plus utilities like guidToNodeId / parseId) live in
 * `@higma-document-models/fig/domain`. Builder ID utilities
 * (FigBuilderState, createFigBuilderState, nextNodeId, nextPageId)
 * live in `@higma-document-models/fig/builder`. Consumers must import
 * those names directly from their owning packages — this barrel
 * deliberately does not re-publish them under shorter aliases (the
 * cross-package re-export ban guards this contract).
 *
 * The only thing this module owns is the `NodeSpec` discriminated
 * union — the declarative shape consumed by `addNode` /
 * `createNodeFromSpec`. NodeSpec is io-specific because the factory
 * that materialises it (`createNodeFromSpec`) lives in this package.
 */

export type {
  NodeSpec,
  BaseNodeSpec,
  RectNodeSpec,
  RoundedRectNodeSpec,
  EllipseNodeSpec,
  LineNodeSpec,
  StarNodeSpec,
  PolygonNodeSpec,
  VectorNodeSpec,
  FrameNodeSpec,
  GroupNodeSpec,
  SectionNodeSpec,
  BooleanOperationNodeSpec,
  TextNodeSpec,
  SymbolNodeSpec,
  InstanceNodeSpec,
} from "./spec-types";
