/**
 * @file Types barrel — io-specific NodeSpec discriminated union.
 *
 * Kiwi document types live in `@higma-document-models/fig/domain`.
 * Builder GUID utilities live in `@higma-document-models/fig/builder`.
 * Consumers must import those names directly from their owning packages.
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
  KiwiStackLayoutFields,
  KiwiChildLayoutFields,
} from "./spec-types";
