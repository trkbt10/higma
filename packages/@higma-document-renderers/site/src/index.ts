/**
 * @file Site document renderer boundary.
 */

import { createSiteDomainSummary, type SiteDocument, type SiteDomainSummary } from "@higma-document-models/site";
import {
  createFigmaRenderOutline,
  type FigmaRenderOutline,
  type FigmaRenderOutlineEntry,
} from "@higma-figma-analysis/render-outline";

export {
  applySiteUnitMovesToNodeChanges,
  createSiteDocumentWithUnitMoves,
  type SiteUnitMove,
} from "./edits";

export type SiteRenderRole = "cms-rich-text" | "repeater" | "responsive-set" | "symbol" | "instance";

export type SiteRenderBounds = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type SiteRenderViewport = SiteRenderBounds;

export type SiteBreakpoint = {
  readonly kind: "site-breakpoint";
  readonly id: string;
  readonly name: string;
  readonly bounds: SiteRenderBounds;
};

export type SiteBreakpointVariant = {
  readonly kind: "site-breakpoint-variant";
  readonly id: string;
  readonly responsiveSetId: string;
  readonly breakpointName: string;
  readonly bounds: SiteRenderBounds;
};

export type SiteRenderSurface = {
  readonly kind: "site-render-surface";
  readonly id: string;
  readonly label: string;
  readonly bounds: SiteRenderBounds;
  readonly breakpointNames: readonly string[];
  readonly variantIds: readonly string[];
};

export type SiteRenderUnitBase<Role extends SiteRenderRole> = {
  readonly kind: "site-render-unit";
  readonly id: string;
  readonly role: Role;
  readonly nodeType: string;
  readonly label: string;
  readonly parentId: string | null;
  readonly childIds: readonly string[];
  readonly depth: number;
  readonly order: number;
  readonly bounds: SiteRenderBounds;
  readonly responsiveSetId: string | null;
  readonly responsiveBreakpointName: string | null;
};

export type SiteCmsRichTextRenderUnit = SiteRenderUnitBase<"cms-rich-text"> & {
  readonly layoutScope: "cms-rich-text";
};

export type SiteRepeaterRenderUnit = SiteRenderUnitBase<"repeater"> & {
  readonly layoutScope: "repeater";
};

export type SiteResponsiveSetRenderUnit = SiteRenderUnitBase<"responsive-set"> & {
  readonly layoutScope: "responsive-set";
};

export type SiteSymbolRenderUnit = SiteRenderUnitBase<"symbol"> & {
  readonly layoutScope: "symbol";
};

export type SiteInstanceRenderUnit = SiteRenderUnitBase<"instance"> & {
  readonly layoutScope: "instance";
};

export type SiteRenderUnit =
  | SiteCmsRichTextRenderUnit
  | SiteRepeaterRenderUnit
  | SiteResponsiveSetRenderUnit
  | SiteSymbolRenderUnit
  | SiteInstanceRenderUnit;

export type SiteCmsSelectorFilter = {
  readonly fieldId: string;
  readonly operator: string;
  readonly comparisonValue: string | number | boolean | null;
};

export type SiteCmsSelectorBinding = {
  readonly kind: "site-cms-selector-binding";
  readonly unitId: string;
  readonly unitRole: SiteRenderRole;
  readonly unitLabel: string;
  readonly collectionId: string;
  readonly matchType: string;
  readonly filters: readonly SiteCmsSelectorFilter[];
  readonly sortCount: number;
  readonly limit: number;
};

export type SiteCmsAliasBinding = {
  readonly source: "parameter" | "variable";
  readonly variableField: string;
  readonly collectionId: string;
  readonly fieldId: string;
  readonly itemId: string;
  readonly dataType: string;
  readonly resolvedDataType: string;
};

export type SiteCmsRichTextBinding = {
  readonly kind: "site-cms-rich-text-binding";
  readonly unitId: string;
  readonly unitRole: "cms-rich-text";
  readonly unitLabel: string;
  readonly aliases: readonly SiteCmsAliasBinding[];
  readonly styleClasses: readonly string[];
};

export type SiteCmsBinding = SiteCmsSelectorBinding | SiteCmsRichTextBinding;

const SITE_RENDER_ROLES = [
  { nodeType: "CMS_RICH_TEXT", role: "cms-rich-text" },
  { nodeType: "REPEATER", role: "repeater" },
  { nodeType: "RESPONSIVE_SET", role: "responsive-set" },
  { nodeType: "SYMBOL", role: "symbol" },
  { nodeType: "INSTANCE", role: "instance" },
] as const;

export type SiteRenderPlan = {
  readonly kind: "site";
  readonly document: SiteDocument;
  readonly insights: SiteDocument["insights"];
  readonly domainSummary: SiteDomainSummary;
  readonly renderOutline: FigmaRenderOutline<SiteRenderRole>;
  readonly renderUnits: readonly SiteRenderUnit[];
  readonly cmsBindings: readonly SiteCmsBinding[];
  readonly viewport: SiteRenderViewport;
  readonly breakpoints: readonly SiteBreakpoint[];
  readonly breakpointVariants: readonly SiteBreakpointVariant[];
  readonly surfaces: readonly SiteRenderSurface[];
};

function asRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  throw new Error(`Expected ${fieldName} to be an object`);
}

function asOptionalRecord(value: unknown, fieldName: string): Record<string, unknown> | null {
  if (value === undefined || value === null) {
    return null;
  }
  return asRecord(value, fieldName);
}

function readString(value: unknown, fieldName: string): string {
  if (typeof value === "string") {
    return value;
  }
  throw new Error(`Expected ${fieldName} to be a string`);
}

function readNumber(value: unknown, fieldName: string): number {
  if (typeof value === "number") {
    return value;
  }
  throw new Error(`Expected ${fieldName} to be a number`);
}

function readEnumName(value: unknown, fieldName: string): string {
  if (typeof value === "string") {
    return value;
  }
  const record = asRecord(value, fieldName);
  return readString(record.name, `${fieldName}.name`);
}

function readEntries(value: unknown, fieldName: string): readonly unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  const record = asOptionalRecord(value, fieldName);
  if (!record) {
    return [];
  }
  if (Array.isArray(record.entries)) {
    return record.entries;
  }
  throw new Error(`Expected ${fieldName}.entries to be an array`);
}

function readOptionalString(value: unknown, fieldName: string): string {
  if (value === undefined || value === null) {
    return "";
  }
  return readString(value, fieldName);
}

function readSiteRenderViewport(document: SiteDocument): SiteRenderViewport {
  const metadata = asRecord(document.canvas.metadata, "canvas.metadata");
  const clientMeta = asRecord(metadata.clientMeta, "canvas.metadata.clientMeta");
  const renderCoordinates = asRecord(clientMeta.renderCoordinates, "canvas.metadata.clientMeta.renderCoordinates");
  return {
    x: readNumber(renderCoordinates.x, "canvas.metadata.clientMeta.renderCoordinates.x"),
    y: readNumber(renderCoordinates.y, "canvas.metadata.clientMeta.renderCoordinates.y"),
    width: readNumber(renderCoordinates.width, "canvas.metadata.clientMeta.renderCoordinates.width"),
    height: readNumber(renderCoordinates.height, "canvas.metadata.clientMeta.renderCoordinates.height"),
  };
}

function readComparisonValue(value: unknown, fieldName: string): string | number | boolean | null {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  throw new Error(`Expected ${fieldName} to be a scalar CMS comparison value`);
}

function readCmsSelectorFilter(value: unknown, index: number): SiteCmsSelectorFilter {
  const record = asRecord(value, `cmsSelector.filterCriteria.filters[${index}]`);
  return {
    fieldId: readString(record.cmsFieldId, `cmsSelector.filterCriteria.filters[${index}].cmsFieldId`),
    operator: readEnumName(record.op, `cmsSelector.filterCriteria.filters[${index}].op`),
    comparisonValue: readComparisonValue(
      record.comparisonValue,
      `cmsSelector.filterCriteria.filters[${index}].comparisonValue`,
    ),
  };
}

function readCmsSelectorFilters(value: unknown): readonly SiteCmsSelectorFilter[] {
  if (!Array.isArray(value)) {
    throw new Error("Expected cmsSelector.filterCriteria.filters to be an array");
  }
  return value.map(readCmsSelectorFilter);
}

function createCmsSelectorBinding(unit: SiteRenderUnit, value: unknown): SiteCmsSelectorBinding | null {
  const selector = asOptionalRecord(value, "cmsSelector");
  if (!selector) {
    return null;
  }
  const filterCriteria = asRecord(selector.filterCriteria, "cmsSelector.filterCriteria");
  return {
    kind: "site-cms-selector-binding",
    unitId: unit.id,
    unitRole: unit.role,
    unitLabel: unit.label,
    collectionId: readString(selector.cmsCollectionId, "cmsSelector.cmsCollectionId"),
    matchType: readEnumName(filterCriteria.matchType, "cmsSelector.filterCriteria.matchType"),
    filters: readCmsSelectorFilters(filterCriteria.filters),
    sortCount: readEntries(selector.sorts, "cmsSelector.sorts").length,
    limit: readNumber(selector.limit, "cmsSelector.limit"),
  };
}

function readCmsAliasBinding(
  value: unknown,
  source: SiteCmsAliasBinding["source"],
  index: number,
): SiteCmsAliasBinding {
  const record = asRecord(value, `${source}ConsumptionMap.entries[${index}]`);
  const variableData = asRecord(record.variableData, `${source}ConsumptionMap.entries[${index}].variableData`);
  const variableValue = asRecord(variableData.value, `${source}ConsumptionMap.entries[${index}].variableData.value`);
  const aliasValue = asRecord(
    variableValue.cmsAliasValue,
    `${source}ConsumptionMap.entries[${index}].variableData.value.cmsAliasValue`,
  );
  return {
    source,
    variableField: readEnumName(record.variableField, `${source}ConsumptionMap.entries[${index}].variableField`),
    collectionId: readString(
      aliasValue.collectionId,
      `${source}ConsumptionMap.entries[${index}].variableData.value.cmsAliasValue.collectionId`,
    ),
    fieldId: readString(
      aliasValue.fieldId,
      `${source}ConsumptionMap.entries[${index}].variableData.value.cmsAliasValue.fieldId`,
    ),
    itemId: readOptionalString(
      aliasValue.itemId,
      `${source}ConsumptionMap.entries[${index}].variableData.value.cmsAliasValue.itemId`,
    ),
    dataType: readEnumName(variableData.dataType, `${source}ConsumptionMap.entries[${index}].variableData.dataType`),
    resolvedDataType: readEnumName(
      variableData.resolvedDataType,
      `${source}ConsumptionMap.entries[${index}].variableData.resolvedDataType`,
    ),
  };
}

function readCmsAliasBindings(
  value: unknown,
  source: SiteCmsAliasBinding["source"],
): readonly SiteCmsAliasBinding[] {
  return readEntries(value, `${source}ConsumptionMap`).map((entry, index) => readCmsAliasBinding(entry, source, index));
}

function readCmsRichTextStyleClass(value: unknown, index: number): string {
  const record = asRecord(value, `cmsRichTextStyleMap.entries[${index}]`);
  return readEnumName(record.styleClass, `cmsRichTextStyleMap.entries[${index}].styleClass`);
}

function readCmsRichTextStyleClasses(value: unknown): readonly string[] {
  return readEntries(value, "cmsRichTextStyleMap").map(readCmsRichTextStyleClass);
}

function readGuidString(node: Record<string, unknown>): string | null {
  const guid = asOptionalRecord(node.guid, "node.guid");
  if (!guid) {
    return null;
  }
  return `${readNumber(guid.sessionID, "node.guid.sessionID")}:${readNumber(guid.localID, "node.guid.localID")}`;
}

function readNodeTypeName(node: Record<string, unknown>, nodeId: string): string {
  return readEnumName(node.type, `node ${nodeId}.type`);
}

function readParentGuidString(node: Record<string, unknown>): string | null {
  const parentIndex = asOptionalRecord(node.parentIndex, "node.parentIndex");
  if (!parentIndex) {
    return null;
  }
  const guid = asRecord(parentIndex.guid, "node.parentIndex.guid");
  return `${readNumber(guid.sessionID, "node.parentIndex.guid.sessionID")}:${readNumber(guid.localID, "node.parentIndex.guid.localID")}`;
}

type SiteAffineMatrix = {
  readonly m00: number;
  readonly m01: number;
  readonly m02: number;
  readonly m10: number;
  readonly m11: number;
  readonly m12: number;
};

const IDENTITY_MATRIX: SiteAffineMatrix = {
  m00: 1,
  m01: 0,
  m02: 0,
  m10: 0,
  m11: 1,
  m12: 0,
};

function multiplyMatrix(parent: SiteAffineMatrix, child: SiteAffineMatrix): SiteAffineMatrix {
  return {
    m00: parent.m00 * child.m00 + parent.m01 * child.m10,
    m01: parent.m00 * child.m01 + parent.m01 * child.m11,
    m02: parent.m00 * child.m02 + parent.m01 * child.m12 + parent.m02,
    m10: parent.m10 * child.m00 + parent.m11 * child.m10,
    m11: parent.m10 * child.m01 + parent.m11 * child.m11,
    m12: parent.m10 * child.m02 + parent.m11 * child.m12 + parent.m12,
  };
}

function readNodeTransform(node: Record<string, unknown>, nodeId: string): SiteAffineMatrix {
  const transform = asRecord(node.transform, `node ${nodeId}.transform`);
  return {
    m00: readNumber(transform.m00, `node ${nodeId}.transform.m00`),
    m01: readNumber(transform.m01, `node ${nodeId}.transform.m01`),
    m02: readNumber(transform.m02, `node ${nodeId}.transform.m02`),
    m10: readNumber(transform.m10, `node ${nodeId}.transform.m10`),
    m11: readNumber(transform.m11, `node ${nodeId}.transform.m11`),
    m12: readNumber(transform.m12, `node ${nodeId}.transform.m12`),
  };
}

function readNodeSize(node: Record<string, unknown>, nodeId: string): { readonly width: number; readonly height: number } {
  const size = asRecord(node.size, `node ${nodeId}.size`);
  return {
    width: readNumber(size.x, `node ${nodeId}.size.x`),
    height: readNumber(size.y, `node ${nodeId}.size.y`),
  };
}

function nodeLocalMatrix(node: Record<string, unknown>, nodeId: string): SiteAffineMatrix {
  if (node.transform) {
    return readNodeTransform(node, nodeId);
  }
  if (!readParentGuidString(node)) {
    return IDENTITY_MATRIX;
  }
  throw new Error(`Site render bounds require transform for non-root node ${nodeId}`);
}

function buildNodeMatrix(
  nodeId: string,
  nodesById: ReadonlyMap<string, Record<string, unknown>>,
  visited: ReadonlySet<string> = new Set(),
): SiteAffineMatrix {
  if (visited.has(nodeId)) {
    throw new Error(`Site render bounds parent cycle at ${nodeId}`);
  }
  const node = nodesById.get(nodeId);
  if (!node) {
    throw new Error(`Site render bounds could not find node ${nodeId}`);
  }
  const parentId = readParentGuidString(node);
  const local = nodeLocalMatrix(node, nodeId);
  if (!parentId) {
    return local;
  }
  return multiplyMatrix(buildNodeMatrix(parentId, nodesById, new Set([...visited, nodeId])), local);
}

function transformPoint(
  matrix: SiteAffineMatrix,
  point: { readonly x: number; readonly y: number },
): { readonly x: number; readonly y: number } {
  return {
    x: matrix.m00 * point.x + matrix.m01 * point.y + matrix.m02,
    y: matrix.m10 * point.x + matrix.m11 * point.y + matrix.m12,
  };
}

function boundsFromTransformedRect(
  matrix: SiteAffineMatrix,
  size: { readonly width: number; readonly height: number },
): SiteRenderBounds {
  const points = [
    transformPoint(matrix, { x: 0, y: 0 }),
    transformPoint(matrix, { x: size.width, y: 0 }),
    transformPoint(matrix, { x: 0, y: size.height }),
    transformPoint(matrix, { x: size.width, y: size.height }),
  ];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function createSiteRenderBounds(
  unitId: string,
  nodesById: ReadonlyMap<string, Record<string, unknown>>,
): SiteRenderBounds {
  const node = nodesById.get(unitId);
  if (!node) {
    throw new Error(`Site render bounds could not find render unit node ${unitId}`);
  }
  return boundsFromTransformedRect(buildNodeMatrix(unitId, nodesById), readNodeSize(node, unitId));
}

function createNodeById(document: SiteDocument): ReadonlyMap<string, Record<string, unknown>> {
  const nodes = document.canvas.nodeChanges.map((nodeChange) => asRecord(nodeChange, "nodeChange"));
  return new Map(nodes.flatMap((node) => {
    const id = readGuidString(node);
    if (!id) {
      return [];
    }
    return [[id, node]];
  }));
}

function parseBreakpointLabel(label: string): string | null {
  const prefix = "Breakpoint=";
  if (!label.startsWith(prefix)) {
    return null;
  }
  return label.slice(prefix.length);
}

function createBreakpointNames(nodesById: ReadonlyMap<string, Record<string, unknown>>): ReadonlySet<string> {
  return new Set([...nodesById.values()].flatMap((node) => {
    if (typeof node.name !== "string") {
      return [];
    }
    const name = parseBreakpointLabel(node.name);
    if (!name) {
      return [];
    }
    return [name];
  }));
}

type SiteResponsiveContext = {
  readonly responsiveSetId: string | null;
  readonly responsiveBreakpointName: string | null;
};

function resolveResponsiveContext(
  nodeId: string,
  nodesById: ReadonlyMap<string, Record<string, unknown>>,
  breakpointNames: ReadonlySet<string>,
): SiteResponsiveContext {
  const node = nodesById.get(nodeId);
  if (!node) {
    throw new Error(`Site responsive context could not find node ${nodeId}`);
  }
  const parentId = readParentGuidString(node);
  if (parentId) {
    const parent = nodesById.get(parentId);
    if (!parent) {
      throw new Error(`Site responsive context could not find parent ${parentId}`);
    }
    if (readNodeTypeName(parent, parentId) === "RESPONSIVE_SET" && typeof node.name === "string" && breakpointNames.has(node.name)) {
      return {
        responsiveSetId: parentId,
        responsiveBreakpointName: node.name,
      };
    }
  }
  if (readNodeTypeName(node, nodeId) === "RESPONSIVE_SET") {
    return {
      responsiveSetId: nodeId,
      responsiveBreakpointName: null,
    };
  }
  if (!parentId) {
    return {
      responsiveSetId: null,
      responsiveBreakpointName: null,
    };
  }
  return resolveResponsiveContext(parentId, nodesById, breakpointNames);
}

function createCmsRichTextBinding(unit: SiteCmsRichTextRenderUnit, node: Record<string, unknown>): SiteCmsRichTextBinding {
  return {
    kind: "site-cms-rich-text-binding",
    unitId: unit.id,
    unitRole: "cms-rich-text",
    unitLabel: unit.label,
    aliases: [
      ...readCmsAliasBindings(node.parameterConsumptionMap, "parameter"),
      ...readCmsAliasBindings(node.variableConsumptionMap, "variable"),
    ],
    styleClasses: readCmsRichTextStyleClasses(node.cmsRichTextStyleMap),
  };
}

function createCmsBindingsForUnit(unit: SiteRenderUnit, node: Record<string, unknown>): readonly SiteCmsBinding[] {
  const selectorBinding = createCmsSelectorBinding(unit, node.cmsSelector);
  if (unit.role === "cms-rich-text") {
    if (!selectorBinding) {
      return [createCmsRichTextBinding(unit, node)];
    }
    return [selectorBinding, createCmsRichTextBinding(unit, node)];
  }
  if (!selectorBinding) {
    return [];
  }
  return [selectorBinding];
}

function siteRenderLabel(entry: FigmaRenderOutlineEntry<SiteRenderRole>): string {
  return entry.name ?? `${entry.type} ${entry.id}`;
}

function siteRenderUnitBase<Role extends SiteRenderRole>(
  entry: FigmaRenderOutlineEntry<SiteRenderRole>,
  role: Role,
  bounds: SiteRenderBounds,
  responsiveContext: SiteResponsiveContext,
): SiteRenderUnitBase<Role> {
  return {
    kind: "site-render-unit",
    id: entry.id,
    role,
    nodeType: entry.type,
    label: siteRenderLabel(entry),
    parentId: entry.parentId,
    childIds: entry.childIds,
    depth: entry.depth,
    order: entry.order,
    bounds,
    responsiveSetId: responsiveContext.responsiveSetId,
    responsiveBreakpointName: responsiveContext.responsiveBreakpointName,
  };
}

function createSiteRenderUnit(
  entry: FigmaRenderOutlineEntry<SiteRenderRole>,
  nodesById: ReadonlyMap<string, Record<string, unknown>>,
  breakpointNames: ReadonlySet<string>,
): SiteRenderUnit {
  const bounds = createSiteRenderBounds(entry.id, nodesById);
  const responsiveContext = resolveResponsiveContext(entry.id, nodesById, breakpointNames);
  switch (entry.role) {
    case "cms-rich-text":
      return { ...siteRenderUnitBase(entry, "cms-rich-text", bounds, responsiveContext), layoutScope: "cms-rich-text" };
    case "repeater":
      return { ...siteRenderUnitBase(entry, "repeater", bounds, responsiveContext), layoutScope: "repeater" };
    case "responsive-set":
      return { ...siteRenderUnitBase(entry, "responsive-set", bounds, responsiveContext), layoutScope: "responsive-set" };
    case "symbol":
      return { ...siteRenderUnitBase(entry, "symbol", bounds, responsiveContext), layoutScope: "symbol" };
    case "instance":
      return { ...siteRenderUnitBase(entry, "instance", bounds, responsiveContext), layoutScope: "instance" };
  }
}

function parseBreakpointName(unit: SiteRenderUnit): string | null {
  if (unit.role !== "symbol") {
    return null;
  }
  return parseBreakpointLabel(unit.label);
}

function createSiteBreakpoints(renderUnits: readonly SiteRenderUnit[]): readonly SiteBreakpoint[] {
  const seen = new Set<string>();
  return renderUnits.flatMap((unit) => {
    const name = parseBreakpointName(unit);
    if (!name) {
      return [];
    }
    if (seen.has(name)) {
      return [];
    }
    seen.add(name);
    return [{
      kind: "site-breakpoint",
      id: unit.id,
      name,
      bounds: unit.bounds,
    }];
  });
}

function createSiteBreakpointVariants(
  nodesById: ReadonlyMap<string, Record<string, unknown>>,
  breakpointNames: ReadonlySet<string>,
): readonly SiteBreakpointVariant[] {
  return [...nodesById.entries()].flatMap(([nodeId, node]) => {
    if (typeof node.name !== "string" || !breakpointNames.has(node.name)) {
      return [];
    }
    const parentId = readParentGuidString(node);
    if (!parentId) {
      return [];
    }
    const parent = nodesById.get(parentId);
    if (!parent) {
      throw new Error(`Site breakpoint variant could not find parent ${parentId}`);
    }
    if (readNodeTypeName(parent, parentId) !== "RESPONSIVE_SET") {
      return [];
    }
    return [{
      kind: "site-breakpoint-variant",
      id: nodeId,
      responsiveSetId: parentId,
      breakpointName: node.name,
      bounds: createSiteRenderBounds(nodeId, nodesById),
    }];
  });
}

function createSiteRenderSurfaces(
  renderUnits: readonly SiteRenderUnit[],
  variants: readonly SiteBreakpointVariant[],
): readonly SiteRenderSurface[] {
  return renderUnits.flatMap((unit) => {
    if (unit.role !== "responsive-set" || unit.responsiveSetId !== unit.id) {
      return [];
    }
    const surfaceVariants = variants.filter((variant) => variant.responsiveSetId === unit.id);
    if (surfaceVariants.length === 0) {
      return [];
    }
    return [{
      kind: "site-render-surface",
      id: unit.id,
      label: unit.label,
      bounds: unit.bounds,
      breakpointNames: surfaceVariants.map((variant) => variant.breakpointName),
      variantIds: surfaceVariants.map((variant) => variant.id),
    }];
  });
}

/** Extract explicit CMS bindings for site editor and renderer consumers. */
export function createSiteCmsBindings(
  document: SiteDocument,
  renderUnits: readonly SiteRenderUnit[],
): readonly SiteCmsBinding[] {
  const nodesById = createNodeById(document);
  return renderUnits.flatMap((unit) => {
    const node = nodesById.get(unit.id);
    if (!node) {
      throw new Error(`Site CMS binding extraction could not find render unit node ${unit.id}`);
    }
    return createCmsBindingsForUnit(unit, node);
  });
}

/** Create a site render plan with explicit layout render units. */
export function createSiteRenderPlan(document: SiteDocument): SiteRenderPlan {
  const renderOutline = createFigmaRenderOutline(document.canvas.nodeChanges, SITE_RENDER_ROLES);
  const nodesById = createNodeById(document);
  const breakpointNames = createBreakpointNames(nodesById);
  const renderUnits = renderOutline.entries.map((entry) => createSiteRenderUnit(entry, nodesById, breakpointNames));
  if (renderUnits.length === 0) {
    throw new Error("Site render plan requires at least one layout render unit");
  }
  const breakpointVariants = createSiteBreakpointVariants(nodesById, breakpointNames);
  return {
    kind: "site",
    document,
    insights: document.insights,
    domainSummary: createSiteDomainSummary(document),
    renderOutline,
    renderUnits,
    cmsBindings: createSiteCmsBindings(document, renderUnits),
    viewport: readSiteRenderViewport(document),
    breakpoints: createSiteBreakpoints(renderUnits),
    breakpointVariants,
    surfaces: createSiteRenderSurfaces(renderUnits, breakpointVariants),
  };
}
