/**
 * @file `RefinePlan` action shapes.
 *
 * Five action kinds, applied strictly in plan order:
 *
 *   1. `create-fill-proxy`     — synthesise a new fill-style proxy.
 *                                Records the temporary token id used
 *                                to refer to it in subsequent bind
 *                                actions.
 *   2. `create-text-proxy`     — same shape, for a text style.
 *   3. `bind-fill-style`       — point a node's `styleIdForFill` at
 *                                either an existing proxy GUID or a
 *                                token id from a `create-fill-proxy`
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
 * `ActionBindFillStyle.proxy` is a discriminated union: either
 * `{ kind: "existing", guid }` (a GUID already in the file) or
 * `{ kind: "token", token }` (resolved to whatever guid the
 * matching `create-fill-proxy` action allocates at apply time).
 */

import type { ColorRGBA } from "../inventory";

export type ActionRename = {
  readonly kind: "rename";
  readonly nodeGuid: string;
  readonly newName: string;
  /** Reason text, surfaced in apply summary for the agent. */
  readonly reason: string;
};

export type ActionCreateFillProxy = {
  readonly kind: "create-fill-proxy";
  /** Plan-local token used by later bind actions to refer to this proxy. */
  readonly token: string;
  readonly name: string;
  readonly color: ColorRGBA;
};

export type ActionCreateTextProxy = {
  readonly kind: "create-text-proxy";
  readonly token: string;
  readonly name: string;
  readonly fontFamily: string;
  readonly fontStyle: string;
  readonly fontWeight: number;
  readonly fontSize: number;
};

export type ProxyRef =
  | { readonly kind: "existing"; readonly guid: string }
  | { readonly kind: "token"; readonly token: string };

export type ActionBindFillStyle = {
  readonly kind: "bind-fill-style";
  readonly nodeGuid: string;
  readonly proxy: ProxyRef;
};

export type ActionBindTextStyle = {
  readonly kind: "bind-text-style";
  readonly nodeGuid: string;
  readonly proxy: ProxyRef;
};

export type ActionPromoteIconCluster = {
  readonly kind: "promote-icon-cluster";
  readonly clusterId: string;
  readonly clusterName: string;
  readonly exemplarGuid: string;
  readonly memberGuids: readonly string[];
};

export type PlanAction =
  | ActionCreateFillProxy
  | ActionCreateTextProxy
  | ActionBindFillStyle
  | ActionBindTextStyle
  | ActionPromoteIconCluster
  | ActionRename;

export type RefinePlan = {
  readonly source: { readonly file: string; readonly bytes: number };
  readonly actions: readonly PlanAction[];
  readonly diagnostics: {
    /** Cluster ids the agent named but the builder declined to promote (e.g. not a leaf-icon cluster). */
    readonly skippedNonPromotableClusters: readonly string[];
  };
};
