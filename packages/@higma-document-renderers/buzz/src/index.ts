/**
 * @file Buzz document renderer boundary.
 */

import { createBuzzDomainSummary, type BuzzDocument, type BuzzDomainSummary } from "@higma-document-models/buzz";
import {
  createFigmaRenderOutline,
  type FigmaRenderOutline,
  type FigmaRenderOutlineEntry,
} from "@higma-figma-analysis/render-outline";

export type BuzzRenderRole = "slide-grid" | "slide-row" | "symbol" | "vector" | "boolean-operation";

export type BuzzRenderUnitBase<Role extends BuzzRenderRole> = {
  readonly kind: "buzz-render-unit";
  readonly id: string;
  readonly role: Role;
  readonly nodeType: string;
  readonly label: string;
  readonly parentId: string | null;
  readonly childIds: readonly string[];
  readonly depth: number;
  readonly order: number;
};

export type BuzzSlideGridRenderUnit = BuzzRenderUnitBase<"slide-grid"> & {
  readonly templateScope: "slide-grid";
};

export type BuzzSlideRowRenderUnit = BuzzRenderUnitBase<"slide-row"> & {
  readonly templateScope: "slide-row";
};

export type BuzzSymbolRenderUnit = BuzzRenderUnitBase<"symbol"> & {
  readonly templateScope: "symbol";
};

export type BuzzVectorRenderUnit = BuzzRenderUnitBase<"vector"> & {
  readonly templateScope: "vector";
};

export type BuzzBooleanOperationRenderUnit = BuzzRenderUnitBase<"boolean-operation"> & {
  readonly templateScope: "boolean-operation";
};

export type BuzzRenderUnit =
  | BuzzSlideGridRenderUnit
  | BuzzSlideRowRenderUnit
  | BuzzSymbolRenderUnit
  | BuzzVectorRenderUnit
  | BuzzBooleanOperationRenderUnit;

const BUZZ_RENDER_ROLES = [
  { nodeType: "SLIDE_GRID", role: "slide-grid" },
  { nodeType: "SLIDE_ROW", role: "slide-row" },
  { nodeType: "SYMBOL", role: "symbol" },
  { nodeType: "VECTOR", role: "vector" },
  { nodeType: "BOOLEAN_OPERATION", role: "boolean-operation" },
] as const;

export type BuzzRenderPlan = {
  readonly kind: "buzz";
  readonly document: BuzzDocument;
  readonly insights: BuzzDocument["insights"];
  readonly domainSummary: BuzzDomainSummary;
  readonly renderOutline: FigmaRenderOutline<BuzzRenderRole>;
  readonly renderUnits: readonly BuzzRenderUnit[];
};

function buzzRenderLabel(entry: FigmaRenderOutlineEntry<BuzzRenderRole>): string {
  return entry.name ?? `${entry.type} ${entry.id}`;
}

function buzzRenderUnitBase<Role extends BuzzRenderRole>(
  entry: FigmaRenderOutlineEntry<BuzzRenderRole>,
  role: Role,
): BuzzRenderUnitBase<Role> {
  return {
    kind: "buzz-render-unit",
    id: entry.id,
    role,
    nodeType: entry.type,
    label: buzzRenderLabel(entry),
    parentId: entry.parentId,
    childIds: entry.childIds,
    depth: entry.depth,
    order: entry.order,
  };
}

function createBuzzRenderUnit(entry: FigmaRenderOutlineEntry<BuzzRenderRole>): BuzzRenderUnit {
  switch (entry.role) {
    case "slide-grid":
      return { ...buzzRenderUnitBase(entry, "slide-grid"), templateScope: "slide-grid" };
    case "slide-row":
      return { ...buzzRenderUnitBase(entry, "slide-row"), templateScope: "slide-row" };
    case "symbol":
      return { ...buzzRenderUnitBase(entry, "symbol"), templateScope: "symbol" };
    case "vector":
      return { ...buzzRenderUnitBase(entry, "vector"), templateScope: "vector" };
    case "boolean-operation":
      return { ...buzzRenderUnitBase(entry, "boolean-operation"), templateScope: "boolean-operation" };
  }
}

/** Create a buzz render plan with explicit template render units. */
export function createBuzzRenderPlan(document: BuzzDocument): BuzzRenderPlan {
  const renderOutline = createFigmaRenderOutline(document.canvas.nodeChanges, BUZZ_RENDER_ROLES);
  const renderUnits = renderOutline.entries.map(createBuzzRenderUnit);
  if (renderUnits.length === 0) {
    throw new Error("Buzz render plan requires at least one template render unit");
  }
  return {
    kind: "buzz",
    document,
    insights: document.insights,
    domainSummary: createBuzzDomainSummary(document),
    renderOutline,
    renderUnits,
  };
}
