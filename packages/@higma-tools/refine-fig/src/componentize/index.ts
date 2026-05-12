/**
 * @file Public entry — componentize.
 *
 * Phase 2 of the SoT consolidation removed the in-place
 * `promoteIconCluster` mutator. Cluster promotion is now expressed
 * through the editor reducer (`PROMOTE_TO_SYMBOL` +
 * `PROMOTE_TO_INSTANCE`) inside `apply-plan.ts`; this module retains
 * only the read-only gating + fingerprint helpers the planner and
 * apply layer consume to decide whether a cluster qualifies.
 */
export {
  isPromotableCluster,
  isLeafIconCluster,
  subtreeFingerprint,
} from "./promote-icon-cluster";
