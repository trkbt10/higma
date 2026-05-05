# Design

## Overview

Deck, buzz, and site renderer packages remain product-specific packages under `@higma-document-renderers`. They depend downward on their matching document model and the product-free render outline analysis package. They must not import each other, document IO, editors, or local file fixtures.

## Implementation Scope

- `packages/@higma-document-renderers/deck/src/index.ts`
  - owns `DeckRenderPlan`
  - owns `createDeckRenderPlan`
- `packages/@higma-document-renderers/buzz/src/index.ts`
  - owns `BuzzRenderPlan`
  - owns `createBuzzRenderPlan`
- `packages/@higma-document-renderers/site/src/index.ts`
  - owns `SiteRenderPlan`
  - owns `createSiteRenderPlan`

Each render plan carries `renderOutline` in addition to document, insights, and domain summary. Empty domain render units are fail-fast errors.
