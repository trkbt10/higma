/**
 * Deep analysis of `Simple Design System (Community).fig`.
 *
 * Questions to answer from the SoT (the file itself):
 *   Q1. Does the embedded NodeType enum declare COMPONENT or COMPONENT_SET?
 *   Q2. Which NodeType.name values actually appear on disk?
 *   Q3. Of all SYMBOL nodes, how many sit under a FRAME parent vs CANVAS?
 *   Q4. Of FRAME parents that contain >=2 SYMBOL children, how many of those
 *       children carry a `Prop=Value` name? Are those parents "variant sets"?
 *   Q5. Do those FRAME parents carry `componentPropertyDefs`? Do their SYMBOL
 *       children carry `variantPropSpecs`? (= what beyond naming convention
 *       is encoded for variant sets)
 *   Q6. Are there any nodes whose `type.value` lies outside the schema's enum
 *       value set? (sanity)
 */

import { readFile } from "node:fs/promises";
import { loadFigFile } from "@higma-document-io/fig/roundtrip";

const PATH = process.env.SDS_FIG_PATH;
if (!PATH) {
  throw new Error("SDS_FIG_PATH must point to `Simple Design System (Community).fig`");
}

type Guid = { readonly sessionID: number; readonly localID: number };

function guidStr(g: Guid | undefined): string {
  if (!g) {
    return "<none>";
  }
  return `${g.sessionID}:${g.localID}`;
}

async function main(): Promise<void> {
  const bytes = await readFile(PATH);
  const loaded = await loadFigFile(new Uint8Array(bytes));
  const nodes = loaded.nodeChanges;
  console.log(`file: ${PATH}`);
  console.log(`nodeChanges: ${nodes.length}`);

  // --- Q1: schema NodeType enum ---
  const nodeTypeDef = loaded.schema.definitions.find((d) => d.name === "NodeType");
  if (!nodeTypeDef) {
    throw new Error("NodeType definition missing");
  }
  const enumFields = nodeTypeDef.fields ?? [];
  const enumByName = new Map<string, number>();
  const enumByValue = new Map<number, string>();
  for (const f of enumFields) {
    enumByName.set(f.name, f.value);
    enumByValue.set(f.value, f.name);
  }
  console.log(`\n=== Q1: NodeType enum in embedded schema ===`);
  console.log(`  total entries: ${enumFields.length}`);
  console.log(`  declares COMPONENT?      ${enumByName.has("COMPONENT")}`);
  console.log(`  declares COMPONENT_SET?  ${enumByName.has("COMPONENT_SET")}`);
  console.log(`  declares CODE_COMPONENT? ${enumByName.has("CODE_COMPONENT")}`);
  console.log(`  declares SYMBOL?         ${enumByName.has("SYMBOL")}  (value=${enumByName.get("SYMBOL")})`);
  console.log(`  declares INSTANCE?       ${enumByName.has("INSTANCE")}  (value=${enumByName.get("INSTANCE")})`);

  // --- Q2: observed NodeType.name histogram ---
  const observedNames = new Map<string, number>();
  const observedValues = new Map<number, number>();
  for (const n of nodes) {
    const name = n.type?.name ?? "<no-name>";
    observedNames.set(name, (observedNames.get(name) ?? 0) + 1);
    const value = n.type?.value;
    if (typeof value === "number") {
      observedValues.set(value, (observedValues.get(value) ?? 0) + 1);
    }
  }
  console.log(`\n=== Q2: observed NodeType.name on nodeChanges ===`);
  const namesSorted = [...observedNames.entries()].sort((a, b) => b[1] - a[1]);
  for (const [name, count] of namesSorted) {
    const enumValue = enumByName.get(name);
    const knownTag = enumValue === undefined ? "  (NOT IN SCHEMA)" : "";
    console.log(`  ${name.padEnd(24)} ${String(count).padStart(6)}  enum=${enumValue ?? "?"}${knownTag}`);
  }

  console.log(`\n=== Q2b: any type.value outside the declared enum? ===`);
  const valuesSorted = [...observedValues.entries()].sort((a, b) => a[0] - b[0]);
  for (const [value, count] of valuesSorted) {
    const declaredName = enumByValue.get(value);
    if (!declaredName) {
      console.log(`  value=${value} (count=${count})  NOT IN ENUM`);
    }
  }
  console.log(`  (no other "NOT IN ENUM" lines means every observed value is declared.)`);

  // Build parent -> children index for the rest.
  const byGuid = new Map<string, typeof nodes[number]>();
  const childrenOf = new Map<string, typeof nodes[number][]>();
  for (const n of nodes) {
    if (n.guid) {
      byGuid.set(guidStr(n.guid), n);
    }
    const parentGuid = n.parentIndex?.guid;
    if (parentGuid) {
      const key = guidStr(parentGuid);
      const list = childrenOf.get(key) ?? [];
      list.push(n);
      childrenOf.set(key, list);
    }
  }

  // --- Q3: SYMBOL parent-type breakdown ---
  console.log(`\n=== Q3: SYMBOL nodes — what is the parent's NodeType? ===`);
  const symbolParentTypes = new Map<string, number>();
  let symbolCount = 0;
  for (const n of nodes) {
    if (n.type?.name !== "SYMBOL") {
      continue;
    }
    symbolCount += 1;
    const parent = n.parentIndex?.guid ? byGuid.get(guidStr(n.parentIndex.guid)) : undefined;
    const parentType = parent?.type?.name ?? "<no-parent>";
    symbolParentTypes.set(parentType, (symbolParentTypes.get(parentType) ?? 0) + 1);
  }
  console.log(`  total SYMBOL nodes: ${symbolCount}`);
  for (const [pt, count] of [...symbolParentTypes.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    parent=${pt.padEnd(20)} ${count}`);
  }

  // --- Q4 + Q5: FRAMEs that look like a variant set ---
  console.log(`\n=== Q4: FRAME parents with >=2 SYMBOL children + Prop=Value names ===`);
  const propEqRe = /^[^=]+=[^=]+/;
  type VariantParent = {
    parent: typeof nodes[number];
    symbolChildren: typeof nodes[number][];
    namedAsVariant: typeof nodes[number][];
    parentHasPropDefs: boolean;
    childrenWithVariantPropSpecs: number;
  };
  const variantParents: VariantParent[] = [];
  for (const parent of nodes) {
    if (parent.type?.name !== "FRAME") {
      continue;
    }
    const kids = childrenOf.get(guidStr(parent.guid)) ?? [];
    const symbolKids = kids.filter((k) => k.type?.name === "SYMBOL");
    if (symbolKids.length < 2) {
      continue;
    }
    const named = symbolKids.filter((k) => propEqRe.test(k.name ?? ""));
    if (named.length < 2) {
      continue;
    }
    const parentPropDefs = parent.componentPropDefs;
    const kidsWithSpecs = symbolKids.filter(
      (k) => k.variantPropSpecs !== undefined && k.variantPropSpecs.length > 0,
    );
    variantParents.push({
      parent,
      symbolChildren: symbolKids,
      namedAsVariant: named,
      parentHasPropDefs: parentPropDefs !== undefined && parentPropDefs.length > 0,
      childrenWithVariantPropSpecs: kidsWithSpecs.length,
    });
  }
  console.log(`  total variant-shaped FRAME parents: ${variantParents.length}`);
  console.log(`  (limit: show first 30)`);
  for (const v of variantParents.slice(0, 30)) {
    console.log(
      `    FRAME guid=${guidStr(v.parent.guid).padEnd(8)}  name=${JSON.stringify(v.parent.name ?? "")}`,
    );
    console.log(
      `      symbol-children=${v.symbolChildren.length}  named-as-variant=${v.namedAsVariant.length}  parent.componentPropDefs?=${v.parentHasPropDefs}  childrenWithVariantPropSpecs=${v.childrenWithVariantPropSpecs}`,
    );
    for (const c of v.symbolChildren.slice(0, 3)) {
      console.log(`        SYMBOL  name=${JSON.stringify(c.name ?? "")}  variantPropSpecs=${c.variantPropSpecs?.length ?? 0}`);
    }
    if (v.symbolChildren.length > 3) {
      console.log(`        ... ${v.symbolChildren.length - 3} more`);
    }
  }

  // --- Q5b: how many FRAME nodes overall carry componentPropDefs? ---
  let frameWithPropDefs = 0;
  for (const n of nodes) {
    if (n.type?.name !== "FRAME") {
      continue;
    }
    if (n.componentPropDefs !== undefined && n.componentPropDefs.length > 0) {
      frameWithPropDefs += 1;
    }
  }
  console.log(`\n=== Q5b: FRAME nodes carrying componentPropDefs (any reason) ===`);
  console.log(`  count: ${frameWithPropDefs}`);

  // --- Q5c: SYMBOL nodes with variantPropSpecs and their parent type ---
  let symbolWithVariantSpecs = 0;
  const variantSpecParentTypes = new Map<string, number>();
  for (const n of nodes) {
    if (n.type?.name !== "SYMBOL") {
      continue;
    }
    if (n.variantPropSpecs === undefined || n.variantPropSpecs.length === 0) {
      continue;
    }
    symbolWithVariantSpecs += 1;
    const parent = n.parentIndex?.guid ? byGuid.get(guidStr(n.parentIndex.guid)) : undefined;
    const pt = parent?.type?.name ?? "<no-parent>";
    variantSpecParentTypes.set(pt, (variantSpecParentTypes.get(pt) ?? 0) + 1);
  }
  console.log(`\n=== Q5c: SYMBOLs that DO carry variantPropSpecs ===`);
  console.log(`  count: ${symbolWithVariantSpecs}`);
  for (const [pt, count] of variantSpecParentTypes.entries()) {
    console.log(`    parent=${pt}  ${count}`);
  }

  // --- Cross-check: do all "variant-shaped" FRAME parents have propDefs, and
  // do all their SYMBOL children have variantPropSpecs? ---
  console.log(`\n=== Cross-check: do propDefs + variantPropSpecs perfectly correlate with naming? ===`);
  const variantParentSet = new Set(variantParents.map((v) => guidStr(v.parent.guid)));
  let parentMissingDefs = 0;
  let kidMissingSpecs = 0;
  for (const v of variantParents) {
    if (!v.parentHasPropDefs) {
      parentMissingDefs += 1;
    }
    for (const c of v.symbolChildren) {
      if (c.variantPropSpecs === undefined || c.variantPropSpecs.length === 0) {
        kidMissingSpecs += 1;
      }
    }
  }
  console.log(`  variant-shaped FRAME parents without componentPropDefs: ${parentMissingDefs} / ${variantParents.length}`);
  console.log(`  SYMBOL children under variant-shaped FRAMEs without variantPropSpecs: ${kidMissingSpecs}`);
  console.log(`  (if both are 0, naming convention perfectly correlates with the kiwi structure)`);

  // Also: are there FRAMEs with propDefs that DON'T show the Prop=Value naming?
  let propDefFrameMissingNaming = 0;
  for (const n of nodes) {
    if (n.type?.name !== "FRAME") {
      continue;
    }
    if (n.componentPropDefs === undefined || n.componentPropDefs.length === 0) {
      continue;
    }
    const isVariantShaped = variantParentSet.has(guidStr(n.guid));
    if (!isVariantShaped) {
      propDefFrameMissingNaming += 1;
    }
  }
  console.log(`  FRAMEs with componentPropDefs but no Prop=Value sibling naming: ${propDefFrameMissingNaming}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
