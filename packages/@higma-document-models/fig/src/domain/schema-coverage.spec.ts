/**
 * @file Enforce the schema-coverage invariant.
 *
 * Every Kiwi-declared field on `NodeChange` must be explicitly classified
 * in `KIWI_NODECHANGE_HANDLING`. New fields land in `todo`, which fails
 * the spec until a real classification (`mapped` / `dropped`) is committed.
 */

import { FIGMA_KIWI_SCHEMA } from "@higma-figma-schema/profiles";
import { KIWI_NODECHANGE_HANDLING, type KiwiFieldHandling } from "./schema-coverage";

function nodeChangeFieldNames(): readonly string[] {
  const def = FIGMA_KIWI_SCHEMA.definitions.find((d) => d.name === "NodeChange");
  if (!def) {
    throw new Error("schema-coverage: NodeChange definition not found in FIGMA_KIWI_SCHEMA");
  }
  const fields = def.fields ?? [];
  const names: string[] = [];
  for (const f of fields) {
    if (typeof f.name === "string") {
      names.push(f.name);
    }
  }
  return names;
}

function isMappedWithoutDomainTarget(entry: KiwiFieldHandling): boolean {
  if (entry.kind !== "mapped") { return false; }
  if (typeof entry.to !== "string") { return true; }
  return entry.to.length === 0;
}

/**
 * Baseline-style invariant:
 *   - Every Kiwi-declared field MUST appear in `KIWI_NODECHANGE_HANDLING`
 *     (no missing). New Kiwi schema fields trigger immediate failure.
 *   - The number of `todo` entries must not exceed
 *     `TODO_BASELINE`. Adding a new `todo` (because a new schema field
 *     landed, or because someone demoted a `mapped` entry to `todo`)
 *     fails the spec.
 *   - When `todo` entries are resolved (`mapped`/`dropped`),
 *     this constant must be lowered to match — the spec fails if the
 *     baseline is stale (count strictly lower than baseline), so progress
 *     cannot be silently lost.
 *
 * This is intentionally a manual ratchet: the goal is to close the
 * divergence surface deliberately, one decision at a time.
 */
const TODO_BASELINE = 0;

describe("Kiwi NodeChange field coverage", () => {
  it("every Kiwi-declared field appears in KIWI_NODECHANGE_HANDLING (none missing)", () => {
    const declared = nodeChangeFieldNames();
    const missing: string[] = [];
    for (const name of declared) {
      if (KIWI_NODECHANGE_HANDLING[name] === undefined) {
        missing.push(name);
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `schema-coverage: ${missing.length} Kiwi-declared field(s) have no entry in ` +
        `KIWI_NODECHANGE_HANDLING. Add them with kind: "todo" at minimum. ` +
        `Sample: ${missing.slice(0, 20).join(", ")}`,
      );
    }
    expect(missing).toEqual([]);
  });

  it("count of `todo` entries does not exceed the baseline (regression guard)", () => {
    const declared = nodeChangeFieldNames();
    const todo: string[] = [];
    for (const name of declared) {
      if (KIWI_NODECHANGE_HANDLING[name]?.kind === "todo") {
        todo.push(name);
      }
    }
    if (todo.length > TODO_BASELINE) {
      throw new Error(
        `schema-coverage: ${todo.length} 'todo' entries (baseline=${TODO_BASELINE}). ` +
        `A new Kiwi field landed as 'todo' or a mapped entry was demoted to 'todo'. ` +
        `Classify it before merging.`,
      );
    }
    if (todo.length < TODO_BASELINE) {
      throw new Error(
        `schema-coverage: ${todo.length} 'todo' entries — baseline is stale ` +
        `(constant=${TODO_BASELINE}). Lower TODO_BASELINE to ${todo.length} in this file.`,
      );
    }
    expect(todo.length).toBe(TODO_BASELINE);
  });

  it("no entries reference fields the Kiwi schema does not declare", () => {
    const declared = new Set(nodeChangeFieldNames());
    const stale: string[] = [];
    for (const name of Object.keys(KIWI_NODECHANGE_HANDLING)) {
      if (!declared.has(name)) {
        stale.push(name);
      }
    }
    expect(stale).toEqual([]);
  });

  it("every `mapped` entry names its Kiwi consumer via `to`", () => {
    const bad: string[] = [];
    for (const [name, entry] of Object.entries(KIWI_NODECHANGE_HANDLING)) {
      if (isMappedWithoutDomainTarget(entry)) {
        bad.push(name);
      }
    }
    expect(bad).toEqual([]);
  });

  it("every `dropped` entry carries a recognized reason", () => {
    const allowed = new Set([
      "kiwi-internal",
      "resolved-elsewhere",
      "metadata-not-rendered",
      "feature-not-supported",
      "experimental",
    ]);
    const bad: { name: string; reason: string }[] = [];
    for (const [name, entry] of Object.entries(KIWI_NODECHANGE_HANDLING)) {
      if (entry.kind === "dropped" && !allowed.has(entry.reason)) {
        bad.push({ name, reason: entry.reason });
      }
    }
    expect(bad).toEqual([]);
  });

  it("classifies guid/symbol structural fields by their actual implementation boundary", () => {
    expect(KIWI_NODECHANGE_HANDLING.guid).toMatchObject({ kind: "mapped", to: "guid" });
    expect(KIWI_NODECHANGE_HANDLING.phase).toMatchObject({ kind: "dropped", reason: "resolved-elsewhere" });
    expect(KIWI_NODECHANGE_HANDLING.parentIndex).toMatchObject({ kind: "mapped", to: "FigKiwiDocumentIndex.childrenOf" });
    expect(KIWI_NODECHANGE_HANDLING.key).toMatchObject({ kind: "mapped", to: "FigNode.key" });
    expect(KIWI_NODECHANGE_HANDLING.fileAssetIds).toMatchObject({ kind: "mapped", to: "FigNode.fileAssetIds" });
    expect(KIWI_NODECHANGE_HANDLING.styleID).toMatchObject({ kind: "mapped", to: "FigNode.styleID" });
    expect(KIWI_NODECHANGE_HANDLING.componentPropDefs).toMatchObject({ kind: "mapped", to: "componentPropDefs" });
    expect(KIWI_NODECHANGE_HANDLING.componentPropRefs).toMatchObject({ kind: "mapped", to: "componentPropRefs" });
    expect(KIWI_NODECHANGE_HANDLING.symbolData).toMatchObject({ kind: "mapped" });
    expect(KIWI_NODECHANGE_HANDLING.componentPropAssignments).toMatchObject({ kind: "mapped", to: "componentPropAssignments" });
    expect(KIWI_NODECHANGE_HANDLING.guides).toMatchObject({ kind: "mapped", to: "FigNode.guides" });
    expect(KIWI_NODECHANGE_HANDLING.symbolLinks).toMatchObject({ kind: "mapped", to: "FigNode.symbolLinks" });
    expect(KIWI_NODECHANGE_HANDLING.overrideKey).toMatchObject({ kind: "mapped", to: "SymbolResolver.overrideKeySlotIndex" });
    expect(KIWI_NODECHANGE_HANDLING.backingNodeId).toMatchObject({ kind: "mapped", to: "FigNode.backingNodeId" });
    expect(KIWI_NODECHANGE_HANDLING.guidPath).toMatchObject({ kind: "dropped", reason: "feature-not-supported" });
  });
});
