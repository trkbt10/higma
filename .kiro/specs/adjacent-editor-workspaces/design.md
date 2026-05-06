# Design

## Overview

Deck, buzz, and site editor packages assemble product-specific workspaces from their matching document model, IO loader, renderer plan, and product-free editor session contract. They remain above renderer and IO layers, and they do not share code through sibling editor packages.

## Implementation Scope

- `packages/@higma-document-editors/deck/src/index.ts`
  - owns `DeckEditorSession`
  - owns `DeckEditorOverview`
  - owns `DeckEditableUnit`
  - owns `createDeckEditorSession`
  - owns `createDeckEditorWorkspace`
- `packages/@higma-document-editors/buzz/src/index.ts`
  - owns `BuzzEditorSession`
  - owns `BuzzEditorOverview`
  - owns `BuzzEditableUnit`
  - owns `createBuzzEditorSession`
  - owns `createBuzzEditorWorkspace`
- `packages/@higma-document-editors/site/src/index.ts`
  - owns `SiteEditorSession`
  - owns `SiteEditorOverview`
  - owns `SiteEditableUnit`
  - owns `createSiteEditorSession`
  - owns `createSiteEditorWorkspace`

The overview expands beyond metadata counts by exposing render unit count, schema definition names, node type names, and metadata flags required by editor inspection surfaces. Each workspace also exposes product-specific editable units derived from renderer render units so the editor boundary is not a load/session wrapper.
