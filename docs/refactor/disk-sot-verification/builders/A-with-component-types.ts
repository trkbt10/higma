/**
 * Hypothesis-check fixture A:
 *
 *   The real Figma `.fig` schema does NOT declare COMPONENT or COMPONENT_SET
 *   as NodeType entries. This script forcibly inserts them and writes a node
 *   using them, to see whether Figma can still open the file.
 *
 * Procedure:
 *  - load components.fig (real Figma export, has 3 SYMBOL nodes)
 *  - patch the embedded NodeType enum: append COMPONENT=61 and COMPONENT_SET=62
 *  - rewrite one SYMBOL ("Button") -> { value: 61, name: "COMPONENT" }
 *  - rewrite that SYMBOL's parent CANVAS to a new FRAME?  NO -- we cannot
 *    change CANVAS to anything else without breaking the document structure.
 *    Instead: introduce a single COMPONENT_SET node as the parent of "Button"
 *    is not feasible without restructuring parentIndex of every sibling.
 *  - Simpler: rewrite ONE existing SYMBOL to COMPONENT.  That alone is enough
 *    to test the schema-acceptance question.  COMPONENT_SET test is omitted
 *    in file A (it would need a tree restructure).
 *
 * Output: docs/refactor/disk-sot-verification/artifacts/A-with-component-types.fig
 */

import { readFile, writeFile } from "node:fs/promises";
import { loadFigFile, saveFigFile } from "@higma-document-io/fig/roundtrip";

const SOURCE = "packages/@higma-document-renderers/fig/fixtures/components/components.fig";
const OUT = "docs/refactor/disk-sot-verification/artifacts/A-with-component-types.fig";

async function main(): Promise<void> {
  const bytes = await readFile(SOURCE);
  const loaded = await loadFigFile(new Uint8Array(bytes));

  // Patch schema: append COMPONENT=61 and COMPONENT_SET=62 to NodeType enum.
  const nodeTypeDef = loaded.schema.definitions.find((d) => d.name === "NodeType");
  if (!nodeTypeDef) {
    throw new Error("NodeType definition not found in schema");
  }
  const fields = [...(nodeTypeDef.fields ?? [])];
  const usedValues = new Set(fields.map((f) => f.value));
  if (usedValues.has(61) || usedValues.has(62)) {
    throw new Error("values 61 or 62 already used; pick different numbers");
  }
  fields.push({ name: "COMPONENT", type: "MessageType", typeId: 0, isArray: false, value: 61 });
  fields.push({ name: "COMPONENT_SET", type: "MessageType", typeId: 0, isArray: false, value: 62 });
  const patchedSchema = {
    ...loaded.schema,
    definitions: loaded.schema.definitions.map((d) =>
      d.name === "NodeType" ? { ...d, fields } : d,
    ),
  };

  // Find a SYMBOL node to rewrite. Pick "Button".
  const target = loaded.nodeChanges.find((n) => n.type?.name === "SYMBOL" && n.name === "Button");
  if (!target) {
    throw new Error("Button SYMBOL not found");
  }
  const rewritten = loaded.nodeChanges.map((n) => {
    if (n === target) {
      return {
        ...n,
        type: { value: 61, name: "COMPONENT" as const },
      };
    }
    return n;
  });

  const data = await saveFigFile(
    {
      ...loaded,
      schema: patchedSchema,
      compressedSchema: new Uint8Array(0),
      nodeChanges: rewritten,
    },
    { reencodeSchema: true },
  );

  await writeFile(OUT, data);
  console.log(`wrote ${OUT}  (${data.length} bytes)`);
  console.log(`  - schema NodeType entries: ${fields.length} (added COMPONENT=61, COMPONENT_SET=62)`);
  console.log(`  - node 'Button' rewritten: SYMBOL -> COMPONENT`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
