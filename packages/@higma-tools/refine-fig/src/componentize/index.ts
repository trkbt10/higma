/**
 * @file Public entry — componentize.
 *
 * Cluster promotion planning reads Kiwi nodeChanges and returns
 * decisions for the apply layer. It does not publish an editor-side
 * document shape.
 */
export {
  isPromotableCluster,
  structureFingerprint,
} from "./promote-icon-cluster";
