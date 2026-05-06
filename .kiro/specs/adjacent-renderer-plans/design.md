# Design

## Overview

Deck, buzz, and site renderer packages remain product-specific packages under `@higma-document-renderers`. They depend downward on their matching document model and the product-free render outline analysis package. They must not import each other, document IO, editors, or local file fixtures.

## Implementation Scope

- `packages/@higma-document-renderers/deck/src/index.ts`
  - owns `DeckRenderPlan`
  - owns `DeckRenderUnit`
  - owns `createDeckRenderPlan`
- `packages/@higma-document-renderers/buzz/src/index.ts`
  - owns `BuzzRenderPlan`
  - owns `BuzzRenderUnit`
  - owns `createBuzzRenderPlan`
- `packages/@higma-document-renderers/site/src/index.ts`
  - owns `SiteRenderPlan`
  - owns `SiteRenderUnit`
  - owns `createSiteRenderPlan`

Each render plan carries `renderOutline` and product-specific render units in addition to document, insights, and domain summary. The outline remains the product-free traversal result; render units are the product renderer contract. Empty domain render units are fail-fast errors.
