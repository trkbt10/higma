/**
 * @file Site editor workspace boundary.
 */

import { createSiteDomainSummary, type SiteDocument, type SiteDomainSummary } from "@higma-document-models/site";
import {
  exportEditedSiteDocument as exportEditedSiteDocumentBytes,
  loadSiteDocumentResult,
  type SiteEditPayload,
} from "@higma-document-io/site";
import {
  createFigFamilyDesignDocument,
  createFigFamilyRenderOptions,
} from "@higma-figma-runtime/react-renderer";
import type { FigDesignDocument, FigPage } from "@higma-document-models/fig/domain";
import type { SceneGraphRenderOptions } from "@higma-document-renderers/fig/scene-graph/render";
import {
  createSiteRenderPlan,
  type SiteBreakpointVariant,
  type SiteRenderPlan,
  type SiteRenderUnit,
} from "@higma-document-renderers/site";
import { createEditorSession, type EditorSession } from "@higma-editor-surfaces/sessions";

export type SiteEditorSession = EditorSession<SiteDocument, "site", SiteDocument["insights"]>;

export type SiteEditorOverview = {
  readonly nodeCount: number;
  readonly renderUnitCount: number;
  readonly schemaDefinitionCount: number;
  readonly schemaDefinitionNames: readonly string[];
  readonly nodeTypeNames: readonly string[];
  readonly metadataKeys: readonly string[];
  readonly clientMetaKeys: readonly string[];
  readonly metadataFlags: {
    readonly hasRenderCoordinates: boolean;
    readonly hasThumbnailSize: boolean;
    readonly hasDeveloperRelatedLinks: boolean;
    readonly hasExportTimestamp: boolean;
  };
  readonly domainSummary: SiteDomainSummary;
};

export type SiteEditableUnit = {
  readonly kind: "site-editable-unit";
  readonly id: string;
  readonly role: SiteRenderUnit["role"];
  readonly label: string;
  readonly parentId: string | null;
  readonly childIds: readonly string[];
  readonly depth: number;
  readonly layoutScope: SiteRenderUnit["layoutScope"];
  readonly bounds: SiteRenderUnit["bounds"];
  readonly responsiveSetId: string | null;
  readonly responsiveBreakpointName: string | null;
  readonly operationTarget: "site-layout-structure";
};

export type SiteFigRenderSurface = {
  readonly document: FigDesignDocument;
  readonly page: FigPage;
  readonly renderOptions?: SceneGraphRenderOptions;
};

export type SiteFigRenderSurfaceOptions = {
  readonly activeSurfaceId: string | null;
  readonly activeBreakpointName: string | null;
  readonly breakpointVariants: readonly SiteBreakpointVariant[];
};

export type SiteEditorWorkspace = {
  readonly session: SiteEditorSession;
  readonly renderPlan: SiteRenderPlan;
  readonly overview: SiteEditorOverview;
  readonly editableUnits: readonly SiteEditableUnit[];
  readonly cmsBindings: SiteRenderPlan["cmsBindings"];
  readonly breakpoints: SiteRenderPlan["breakpoints"];
  readonly breakpointVariants: SiteRenderPlan["breakpointVariants"];
  readonly surfaces: SiteRenderPlan["surfaces"];
  readonly figRenderSurface: SiteFigRenderSurface;
};

function createSiteEditorOverview(document: SiteDocument, renderPlan: SiteRenderPlan): SiteEditorOverview {
  return {
    nodeCount: document.summary.totalNodes,
    renderUnitCount: renderPlan.renderOutline.entries.length,
    schemaDefinitionCount: document.insights.schema.definitionCount,
    schemaDefinitionNames: document.insights.schema.definitionNames,
    nodeTypeNames: [...document.summary.nodeTypes.keys()].sort(),
    metadataKeys: document.insights.metadata.rawKeys,
    clientMetaKeys: document.insights.metadata.clientMetaKeys,
    metadataFlags: {
      hasRenderCoordinates: document.insights.metadata.hasRenderCoordinates,
      hasThumbnailSize: document.insights.metadata.hasThumbnailSize,
      hasDeveloperRelatedLinks: document.insights.metadata.hasDeveloperRelatedLinks,
      hasExportTimestamp: document.insights.metadata.hasExportTimestamp,
    },
    domainSummary: createSiteDomainSummary(document),
  };
}

/** Convert a site render unit into the editor operation unit contract. */
export function createSiteEditableUnit(unit: SiteRenderUnit): SiteEditableUnit {
  return {
    kind: "site-editable-unit",
    id: unit.id,
    role: unit.role,
    label: unit.label,
    parentId: unit.parentId,
    childIds: unit.childIds,
    depth: unit.depth,
    layoutScope: unit.layoutScope,
    bounds: unit.bounds,
    responsiveSetId: unit.responsiveSetId,
    responsiveBreakpointName: unit.responsiveBreakpointName,
    operationTarget: "site-layout-structure",
  };
}

/** Create a site editor session from a site document model. */
export function createSiteEditorSession(document: SiteDocument): SiteEditorSession {
  return createEditorSession("site", document, document.insights);
}

type FigFamilyRenderableNode = FigPage["children"][number];

function variantBelongsToActiveSurface(
  variant: SiteBreakpointVariant,
  activeSurfaceId: string | null,
): boolean {
  if (!activeSurfaceId) {
    return true;
  }
  return variant.responsiveSetId === activeSurfaceId;
}

function readVariantNodeIds(options: SiteFigRenderSurfaceOptions | null): ReadonlySet<string> | null {
  if (!options?.activeBreakpointName) {
    return null;
  }
  const ids = options.breakpointVariants
    .filter((variant) => variant.breakpointName === options.activeBreakpointName)
    .filter((variant) => variantBelongsToActiveSurface(variant, options.activeSurfaceId))
    .map((variant) => variant.id);
  if (ids.length === 0) {
    throw new Error(`Site fig render surface requires variant nodes for breakpoint ${options.activeBreakpointName}`);
  }
  return new Set(ids);
}

function filterNodeForVariantIds(
  node: FigFamilyRenderableNode,
  variantNodeIds: ReadonlySet<string>,
): FigFamilyRenderableNode | null {
  if (variantNodeIds.has(node.id)) {
    return node;
  }
  const children = node.children?.flatMap((child) => {
    const filteredChild = filterNodeForVariantIds(child, variantNodeIds);
    if (!filteredChild) {
      return [];
    }
    return [filteredChild];
  });
  if (!children || children.length === 0) {
    return null;
  }
  return {
    ...node,
    children,
  };
}

function filterPageChildrenForVariants(
  children: readonly FigFamilyRenderableNode[],
  variantNodeIds: ReadonlySet<string> | null,
): readonly FigFamilyRenderableNode[] {
  if (!variantNodeIds) {
    return children;
  }
  const filteredChildren = children.flatMap((child) => {
    const filteredChild = filterNodeForVariantIds(child, variantNodeIds);
    if (!filteredChild) {
      return [];
    }
    return [filteredChild];
  });
  if (filteredChildren.length === 0) {
    throw new Error("Site fig render surface could not resolve active breakpoint variant nodes");
  }
  return filteredChildren;
}

/** Create the shared fig renderer input for a site document canvas. */
export function createSiteFigRenderSurface(
  document: SiteDocument,
  options: SiteFigRenderSurfaceOptions | null = null,
): SiteFigRenderSurface {
  const figDocument = createFigFamilyDesignDocument(document.canvas, { canvasVisibility: "all" });
  const page = figDocument.pages[0];
  if (!page) {
    throw new Error("Site editor requires at least one renderable fig-family page");
  }
  const variantNodeIds = readVariantNodeIds(options);
  const children = filterPageChildrenForVariants(figDocument.pages.flatMap((item) => item.children), variantNodeIds);
  return {
    document: figDocument,
    page: {
      ...page,
      children,
    },
    renderOptions: createFigFamilyRenderOptions(figDocument),
  };
}

function isBreakpointUnit(unit: SiteRenderUnit): boolean {
  return unit.role === "symbol" && unit.label.startsWith("Breakpoint=");
}

/** Create the editor-facing site workspace from a decoded product document. */
export function createSiteEditorWorkspace(document: SiteDocument): SiteEditorWorkspace {
  const renderPlan = createSiteRenderPlan(document);
  return {
    session: createSiteEditorSession(document),
    renderPlan,
    overview: createSiteEditorOverview(document, renderPlan),
    editableUnits: renderPlan.renderUnits.filter((unit) => !isBreakpointUnit(unit)).map(createSiteEditableUnit),
    cmsBindings: renderPlan.cmsBindings,
    breakpoints: renderPlan.breakpoints,
    breakpointVariants: renderPlan.breakpointVariants,
    surfaces: renderPlan.surfaces,
    figRenderSurface: createSiteFigRenderSurface(document),
  };
}

/** Open packaged or raw site bytes as an editor workspace. */
export async function openSiteEditor(data: Uint8Array): Promise<SiteEditorWorkspace> {
  const result = await loadSiteDocumentResult(data);
  return createSiteEditorWorkspace(result.document);
}

/** Export edited site bytes from the original file data and committed editor edits. */
export async function exportEditedSiteDocument(
  data: Uint8Array,
  edits: SiteEditPayload,
): Promise<Uint8Array> {
  return exportEditedSiteDocumentBytes(data, edits);
}
