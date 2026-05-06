/**
 * @file Deck document renderer boundary.
 */

import { createDeckDomainSummary, type DeckDocument, type DeckDomainSummary } from "@higma-document-models/deck";
import {
  createFigmaRenderOutline,
  type FigmaRenderOutline,
  type FigmaRenderOutlineEntry,
} from "@higma-figma-analysis/render-outline";

export type DeckRenderRole = "slide-grid" | "slide-row" | "slide" | "interactive-slide-element";

export type DeckRenderUnitBase<Role extends DeckRenderRole> = {
  readonly kind: "deck-render-unit";
  readonly id: string;
  readonly role: Role;
  readonly nodeType: string;
  readonly label: string;
  readonly parentId: string | null;
  readonly childIds: readonly string[];
  readonly depth: number;
  readonly order: number;
};

export type DeckSlideGridRenderUnit = DeckRenderUnitBase<"slide-grid"> & {
  readonly presentationScope: "slide-grid";
};

export type DeckSlideRowRenderUnit = DeckRenderUnitBase<"slide-row"> & {
  readonly presentationScope: "slide-row";
};

export type DeckSlideRenderUnit = DeckRenderUnitBase<"slide"> & {
  readonly presentationScope: "slide";
};

export type DeckInteractiveSlideElementRenderUnit = DeckRenderUnitBase<"interactive-slide-element"> & {
  readonly presentationScope: "interactive-slide-element";
};

export type DeckRenderUnit =
  | DeckSlideGridRenderUnit
  | DeckSlideRowRenderUnit
  | DeckSlideRenderUnit
  | DeckInteractiveSlideElementRenderUnit;

const DECK_RENDER_ROLES = [
  { nodeType: "SLIDE_GRID", role: "slide-grid" },
  { nodeType: "SLIDE_ROW", role: "slide-row" },
  { nodeType: "SLIDE", role: "slide" },
  { nodeType: "INTERACTIVE_SLIDE_ELEMENT", role: "interactive-slide-element" },
] as const;

export type DeckRenderPlan = {
  readonly kind: "deck";
  readonly document: DeckDocument;
  readonly insights: DeckDocument["insights"];
  readonly domainSummary: DeckDomainSummary;
  readonly renderOutline: FigmaRenderOutline<DeckRenderRole>;
  readonly renderUnits: readonly DeckRenderUnit[];
};

function deckRenderLabel(entry: FigmaRenderOutlineEntry<DeckRenderRole>): string {
  return entry.name ?? `${entry.type} ${entry.id}`;
}

function deckRenderUnitBase<Role extends DeckRenderRole>(
  entry: FigmaRenderOutlineEntry<DeckRenderRole>,
  role: Role,
): DeckRenderUnitBase<Role> {
  return {
    kind: "deck-render-unit",
    id: entry.id,
    role,
    nodeType: entry.type,
    label: deckRenderLabel(entry),
    parentId: entry.parentId,
    childIds: entry.childIds,
    depth: entry.depth,
    order: entry.order,
  };
}

function createDeckRenderUnit(entry: FigmaRenderOutlineEntry<DeckRenderRole>): DeckRenderUnit {
  switch (entry.role) {
    case "slide-grid":
      return { ...deckRenderUnitBase(entry, "slide-grid"), presentationScope: "slide-grid" };
    case "slide-row":
      return { ...deckRenderUnitBase(entry, "slide-row"), presentationScope: "slide-row" };
    case "slide":
      return { ...deckRenderUnitBase(entry, "slide"), presentationScope: "slide" };
    case "interactive-slide-element":
      return { ...deckRenderUnitBase(entry, "interactive-slide-element"), presentationScope: "interactive-slide-element" };
  }
}

/** Create a deck render plan with explicit presentation render units. */
export function createDeckRenderPlan(document: DeckDocument): DeckRenderPlan {
  const renderOutline = createFigmaRenderOutline(document.canvas.nodeChanges, DECK_RENDER_ROLES);
  const renderUnits = renderOutline.entries.map(createDeckRenderUnit);
  if (renderUnits.length === 0) {
    throw new Error("Deck render plan requires at least one presentation render unit");
  }
  return {
    kind: "deck",
    document,
    insights: document.insights,
    domainSummary: createDeckDomainSummary(document),
    renderOutline,
    renderUnits,
  };
}
