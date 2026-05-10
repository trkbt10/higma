/**
 * @file Schema-coverage rule.
 *
 * Figma's importer reads the message body using the schema embedded
 * in the file. If the file's schema is missing definitions Figma
 * needs (Blob, Effect, VectorData, RGBA, etc.) the importer either
 * silently drops fields or rejects the file outright. We treat any
 * shrinkage relative to the canonical bundled schema as an error.
 *
 * The bundled `figma-schema.json` is the SoT — it ships with every
 * release of `@higma-document-io/fig` and is what `FigFileBuilder`
 * writes out. A healthy file contains a superset of the bundled
 * schema's definitions (Figma may add new types over time, but it
 * never removes core ones).
 */

import figmaSchema from "../../fig-file/figma-schema.json";
import type { KiwiSchema } from "@higma-codecs/kiwi/types";
import type { LintRule } from "../types";

// The bundled schema JSON ships with a slightly looser `kind` typing
// than the strict KiwiSchema (string vs union). We only read the
// definition names here, so a structural projection is enough; this
// keeps the file free of `as unknown` while still typing the data.
type SchemaShape = { readonly definitions: readonly { readonly name: string }[] };
const REFERENCE_SCHEMA: SchemaShape = figmaSchema;

const HARD_REQUIRED_DEFINITIONS: readonly string[] = [
  "Message",
  "MessageType",
  "NodeChange",
  "NodeType",
  "NodePhase",
  "GUID",
  "Vector",
  "Matrix",
  "Color",
  "Paint",
  "PaintType",
  "Blob",
  "Effect",
  "EffectType",
  "VectorData",
  "ParentIndex",
];

function collectDefinitionNames(schema: KiwiSchema | SchemaShape): ReadonlySet<string> {
  return new Set(schema.definitions.map((definition) => definition.name));
}

function summariseMissing(missing: readonly string[], cap: number = 8): string {
  if (missing.length <= cap) {
    return missing.join(", ");
  }
  return `${missing.slice(0, cap).join(", ")}, … (${missing.length - cap} more)`;
}

export const schemaCoverageRule: LintRule = (ctx, emit) => {
  if (!ctx.schema) {
    return;
  }
  const present = collectDefinitionNames(ctx.schema);
  const referenceNames = collectDefinitionNames(REFERENCE_SCHEMA);

  const hardMissing = HARD_REQUIRED_DEFINITIONS.filter((name) => !present.has(name));
  if (hardMissing.length > 0) {
    emit({
      ruleId: "fig.schema.required-types",
      severity: "error",
      path: "canvas.fig/schema",
      message: `Schema is missing required definitions Figma always emits: ${summariseMissing(hardMissing)}`,
      remediation: "Rebuild with FigFileBuilder, which embeds the canonical Figma schema (figma-schema.json)",
    });
  }

  const coverageMissing: string[] = [];
  for (const name of referenceNames) {
    if (!present.has(name)) {
      coverageMissing.push(name);
    }
  }
  if (coverageMissing.length > 0) {
    const severity = hardMissing.length > 0 ? "error" : "warning";
    emit({
      ruleId: "fig.schema.coverage",
      severity,
      path: "canvas.fig/schema",
      message: `Schema covers only ${present.size}/${referenceNames.size} canonical Figma definitions (missing ${coverageMissing.length})`,
      remediation: "Use FigFileBuilder; it always serialises the bundled figma-schema.json",
    });
  }
};
