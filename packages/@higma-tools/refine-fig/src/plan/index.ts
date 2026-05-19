/**
 * @file Plan layer entry — combine `Inventory` + `Decisions` into a
 * deterministic action list.
 *
 * The plan is a flat array consumed in order by `apply`. Each action
 * carries every field needed; apply does no inference. Action order
 * is significant — styleDefinition creation must precede every binding action
 * that targets the new styleDefinition.
 */
export { buildPlan } from "./build";
export type {
  RefinePlan,
  PlanAction,
  ActionEnsureInternalCanvas,
  ActionRename,
  ActionCreateFillStyleDefinition,
  ActionCreateTextStyleDefinition,
  ActionBindFillStyle,
  ActionBindTextStyle,
  ActionPromoteIconCluster,
  ActionPromoteVectorCluster,
  ActionGroupAsVariantSet,
  ActionSetLayout,
  StyleDefinitionRef,
} from "./types";
