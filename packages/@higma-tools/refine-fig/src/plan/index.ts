/**
 * @file Plan layer entry — combine `Inventory` + `Decisions` into a
 * deterministic action list.
 *
 * The plan is a flat array consumed in order by `apply`. Each action
 * carries every field needed; apply does no inference. Action order
 * is significant — proxy creation must precede every binding action
 * that targets the new proxy.
 */
export { buildPlan } from "./build";
export type {
  RefinePlan,
  PlanAction,
  ActionRename,
  ActionCreateFillProxy,
  ActionCreateTextProxy,
  ActionBindFillStyle,
  ActionBindTextStyle,
  ActionPromoteIconCluster,
  ProxyRef,
} from "./types";
