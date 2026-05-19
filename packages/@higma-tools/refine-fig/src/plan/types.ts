/**
 * @file `RefinePlan` action shapes.
 *
 * Action kinds applied strictly in plan order:
 *
 *   0. `ensure-internal-canvas` — when the source carries no Internal
 *                                Only Canvas, insert one at the head
 *                                of the plan so subsequent
 *                                create-*-style-definition actions have somewhere
 *                                to live. Emitted only when the source
 *                                lacks an internal canvas AND the plan
 *                                contains at least one action that
 *                                requires one.
 *   1. `create-fill-style-definition`     — synthesise a new fill-style styleDefinition.
 *                                Records the temporary token id used
 *                                to refer to it in subsequent bind
 *                                actions.
 *   2. `create-text-style-definition`     — same shape, for a text style.
 *   3. `bind-fill-style`       — point a node's `styleIdForFill` at
 *                                either an existing styleDefinition GUID or a
 *                                token id from a `create-fill-style-definition`
 *                                emitted earlier in the same plan.
 *   4. `bind-text-style`       — same idea for `styleIdForText`.
 *   5. `promote-icon-cluster`  — turn one cluster member into a
 *                                SYMBOL and the rest into INSTANCEs
 *                                pointing at it.
 *   6. `rename`                — set a node's `name`. Renames flow
 *                                from cluster decisions: every
 *                                INSTANCE produced by a promote
 *                                action automatically gets the
 *                                cluster's authored name (no separate
 *                                rename action emitted), but the
 *                                builder also emits explicit rename
 *                                actions for kept-but-not-promoted
 *                                clusters and for individual member
 *                                overrides.
 *
 * `ActionBindFillStyle.styleDefinition` is a discriminated union: either
 * `{ kind: "existing", guid }` (a GUID already in the file) or
 * `{ kind: "token", token }` (resolved to whatever guid the
 * matching `create-fill-style-definition` action allocates at apply time).
 */

import type { ColorRGBA } from "../inventory";

/**
 * Insert a brand-new Internal Only Canvas at the document level. Apply
 * registers the new canvas's GUID internally; subsequent
 * `create-*-style-definition` actions parent the styleDefinition under it. The action
 * intentionally carries no plan-local token — at most one
 * `ensure-internal-canvas` may appear per plan, so the apply layer
 * tracks the resulting GUID as singleton state.
 */
export type ActionEnsureInternalCanvas = {
  readonly kind: "ensure-internal-canvas";
  /** Human-readable name applied to the new CANVAS node. */
  readonly name: string;
};

export type ActionRename = {
  readonly kind: "rename";
  readonly nodeGuid: string;
  readonly newName: string;
  /** Reason text, surfaced in apply summary for the agent. */
  readonly reason: string;
};

export type ActionCreateFillStyleDefinition = {
  readonly kind: "create-fill-style-definition";
  /** Plan-local token used by later bind actions to refer to this styleDefinition. */
  readonly token: string;
  readonly name: string;
  readonly color: ColorRGBA;
};

export type ActionCreateTextStyleDefinition = {
  readonly kind: "create-text-style-definition";
  readonly token: string;
  readonly name: string;
  readonly fontFamily: string;
  readonly fontStyle: string;
  readonly fontWeight: number;
  readonly fontSize: number;
};

export type StyleDefinitionRef =
  | { readonly kind: "existing"; readonly guid: string }
  | { readonly kind: "token"; readonly token: string };

export type ActionBindFillStyle = {
  readonly kind: "bind-fill-style";
  readonly nodeGuid: string;
  readonly styleDefinition: StyleDefinitionRef;
};

export type ActionBindTextStyle = {
  readonly kind: "bind-text-style";
  readonly nodeGuid: string;
  readonly styleDefinition: StyleDefinitionRef;
};

export type ActionPromoteIconCluster = {
  readonly kind: "promote-icon-cluster";
  readonly clusterId: string;
  readonly clusterName: string;
  readonly exemplarGuid: string;
  readonly memberGuids: readonly string[];
};

/**
 * Promote a strict-byte VECTOR cluster: synthesise a fresh SYMBOL
 * containing a clone of the exemplar's geometry, then rewrite every
 * member VECTOR into an INSTANCE of that SYMBOL. The SYMBOL lives on
 * the Internal Only Canvas; each INSTANCE keeps its original
 * transform / parent so layout is preserved at the call site.
 */
export type ActionPromoteVectorCluster = {
  readonly kind: "promote-vector-cluster";
  readonly clusterId: string;
  readonly clusterName: string;
  readonly exemplarGuid: string;
  readonly memberGuids: readonly string[];
};

/**
 * Adopt an auto-layout inference on a FRAME. Apply patches the FRAME
 * with `stackMode`, `stackSpacing`, and per-side padding so Figma
 * treats it as an auto-layout container on next open. Values come
 * from the inventory's `LayoutHint`; apply does not re-infer.
 */
export type ActionSetLayout = {
  readonly kind: "set-layout";
  readonly nodeGuid: string;
  readonly layoutMode: "HORIZONTAL" | "VERTICAL";
  readonly itemSpacing: number;
  readonly paddingTop: number;
  readonly paddingRight: number;
  readonly paddingBottom: number;
  readonly paddingLeft: number;
  readonly counterAxisAlign: "MIN" | "CENTER" | "MAX";
};

/**
 * Group N promoted SYMBOLs (each produced by an earlier
 * `promote-icon-cluster` in the same plan) under a new FRAME, encoded
 * as a Variant Set. Apply:
 *
 *   1. Allocates one new FRAME under the SYMBOLs' shared canvas, with
 *      `isStateGroup = true` and a single VARIANT-typed
 *      `componentPropDefs` entry whose `name` is `propertyName`.
 *   2. For each variant member: rewrites the promoted SYMBOL's name
 *      to `<propertyName>=<value>` and re-parents it under the new
 *      FRAME.
 *
 * Each entry's `clusterId` must match a `promote-icon-cluster.clusterId`
 * earlier in the same plan. The plan builder enforces:
 *
 *   - the cited cluster exists in inventory
 *   - the cited cluster is being promoted (decisions.clusters[id].promoteToSymbol)
 *   - no cluster appears in more than one variant set
 */
export type ActionGroupAsVariantSet = {
  readonly kind: "group-as-variant-set";
  /** Name applied to the new FRAME (Figma's "Component / Variant Set name"). */
  readonly setName: string;
  /** Display name of the variant property (e.g. "Suit"). */
  readonly propertyName: string;
  readonly variants: readonly {
    readonly clusterId: string;
    readonly propertyValue: string;
  }[];
};

export type PlanAction =
  | ActionEnsureInternalCanvas
  | ActionCreateFillStyleDefinition
  | ActionCreateTextStyleDefinition
  | ActionBindFillStyle
  | ActionBindTextStyle
  | ActionPromoteIconCluster
  | ActionPromoteVectorCluster
  | ActionGroupAsVariantSet
  | ActionSetLayout
  | ActionRename;

export type RefinePlan = {
  readonly source: { readonly file: string; readonly bytes: number };
  readonly actions: readonly PlanAction[];
  readonly diagnostics: {
    /** Cluster ids the agent named but the builder declined to promote (e.g. not a leaf-icon cluster). */
    readonly skippedNonPromotableClusters: readonly string[];
  };
};
