/**
 * @file Generate a blank `Decisions` JSON from an `Inventory`.
 *
 * Every key is enumerated with empty values. The agent fills them
 * in. Generating the scaffold (rather than asking the agent to
 * conjure the keys) keeps cluster ids and colour keys in sync with
 * what the inventory observed and prevents typo drift.
 */
import type { Inventory } from "../inventory";
import type { Decisions } from "./types";

/** Generate a blank Decisions JSON whose keys mirror the inventory. */
export function scaffoldDecisions(inventory: Inventory): Decisions {
  const clusters: Record<string, { readonly name: string }> = {};
  for (const c of inventory.subtreeClusters) {
    clusters[c.clusterId] = { name: "" };
  }
  const palette: Record<string, { readonly name: string }> = {};
  for (const p of inventory.palette) {
    palette[p.key] = { name: "" };
  }
  const typography: Record<string, { readonly name: string }> = {};
  for (const t of inventory.typography) {
    typography[t.key] = { name: "" };
  }
  return {
    clusters,
    palette,
    typography,
    variantGroups: {},
  };
}
