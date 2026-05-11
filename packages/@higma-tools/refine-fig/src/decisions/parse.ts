/**
 * @file Boundary parser for `Decisions` JSON.
 *
 * The agent edits the JSON by hand. We validate the shape before the
 * plan layer reads it so a typo in a key (e.g. `clusters` →
 * `cluster`) is reported with a clear message instead of silently
 * losing every decision under that key.
 */
import type {
  Decisions,
  ClusterDecision,
  PaletteDecision,
  TypographyDecision,
  VariantSetDecision,
  LayoutDecision,
  GeometryClusterDecision,
} from "./types";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isObject(value)) {
    return false;
  }
  return Object.values(value).every(isString);
}

function asClusterDecision(raw: unknown): ClusterDecision | undefined {
  if (!isObject(raw)) {
    return undefined;
  }
  if (!isString(raw.name)) {
    return undefined;
  }
  if (raw.promoteToSymbol !== undefined && typeof raw.promoteToSymbol !== "boolean") {
    return undefined;
  }
  if (raw.exemplarGuid !== undefined && !isString(raw.exemplarGuid)) {
    return undefined;
  }
  if (raw.memberOverrides !== undefined && !isStringRecord(raw.memberOverrides)) {
    return undefined;
  }
  return {
    name: raw.name,
    promoteToSymbol: raw.promoteToSymbol,
    exemplarGuid: raw.exemplarGuid,
    memberOverrides: raw.memberOverrides,
  };
}

function asPaletteDecision(raw: unknown): PaletteDecision | undefined {
  if (!isObject(raw) || !isString(raw.name)) {
    return undefined;
  }
  return { name: raw.name };
}

function asTypographyDecision(raw: unknown): TypographyDecision | undefined {
  if (!isObject(raw) || !isString(raw.name)) {
    return undefined;
  }
  if (raw.merge !== undefined && !isString(raw.merge)) {
    return undefined;
  }
  return { name: raw.name, merge: raw.merge };
}

/**
 * Decode the optional `variantSets` field. `undefined` is fine
 * (variant sets are optional). A non-undefined value must be an
 * object, and every entry must parse as a `VariantSetDecision` — any
 * other shape is rejected with a descriptive error.
 */
function decodeOptionalVariantSets(
  raw: unknown,
): Record<string, VariantSetDecision> | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isObject(raw)) {
    throw new Error("parseDecisions: variantSets must be an object when present");
  }
  return mapRecord(raw, asVariantSetDecision, "variantSets");
}

function asGeometryClusterDecision(raw: unknown): GeometryClusterDecision | undefined {
  if (!isObject(raw) || !isString(raw.name)) {
    return undefined;
  }
  return { name: raw.name };
}

function decodeOptionalGeometryClusters(raw: unknown): Record<string, GeometryClusterDecision> | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isObject(raw)) {
    throw new Error("parseDecisions: geometryClusters must be an object when present");
  }
  return mapRecord(raw, asGeometryClusterDecision, "geometryClusters");
}

function asLayoutDecision(raw: unknown): LayoutDecision | undefined {
  if (!isObject(raw)) {
    return undefined;
  }
  if (typeof raw.apply !== "boolean") {
    return undefined;
  }
  return { apply: raw.apply };
}

function decodeOptionalLayouts(raw: unknown): Record<string, LayoutDecision> | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isObject(raw)) {
    throw new Error("parseDecisions: layouts must be an object when present");
  }
  return mapRecord(raw, asLayoutDecision, "layouts");
}

function asVariantSetDecision(raw: unknown): VariantSetDecision | undefined {
  if (!isObject(raw)) {
    return undefined;
  }
  if (!isString(raw.propertyName)) {
    return undefined;
  }
  if (!isStringRecord(raw.variants)) {
    return undefined;
  }
  return { propertyName: raw.propertyName, variants: raw.variants };
}

function mapRecord<T>(source: Record<string, unknown>, asT: (raw: unknown) => T | undefined, label: string): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(source)) {
    const decoded = asT(value);
    if (!decoded) {
      throw new Error(`parseDecisions: ${label}["${key}"] is not a valid ${label} entry`);
    }
    out[key] = decoded;
  }
  return out;
}

/** Validate and decode a `Decisions` JSON. Throws on malformed input. */
export function parseDecisions(jsonText: string): Decisions {
  const parsed: unknown = JSON.parse(jsonText);
  if (!isObject(parsed)) {
    throw new Error("parseDecisions: top-level value must be an object");
  }
  if (!isObject(parsed.clusters) || !isObject(parsed.palette) || !isObject(parsed.typography)) {
    throw new Error("parseDecisions: missing one of clusters / palette / typography");
  }
  const variantSets = decodeOptionalVariantSets(parsed.variantSets);
  const layouts = decodeOptionalLayouts(parsed.layouts);
  const geometryClusters = decodeOptionalGeometryClusters(parsed.geometryClusters);
  return {
    clusters: mapRecord(parsed.clusters, asClusterDecision, "clusters"),
    palette: mapRecord(parsed.palette, asPaletteDecision, "palette"),
    typography: mapRecord(parsed.typography, asTypographyDecision, "typography"),
    variantSets,
    layouts,
    geometryClusters,
  };
}
