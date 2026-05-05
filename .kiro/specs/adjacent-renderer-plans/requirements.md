# Requirements

## Requirement 1: Deck Render Plan Completeness

**User Story:** As a deck renderer, I want a deck render plan with explicit presentation render units, so that slides and interactive presentation elements are not represented by a metadata-only stub.

#### Acceptance Criteria

1. WHEN `createDeckRenderPlan` receives a deck document THEN it SHALL produce a presentation outline for `SLIDE_GRID`, `SLIDE_ROW`, `SLIDE`, and `INTERACTIVE_SLIDE_ELEMENT`.
2. WHEN the deck document contains no presentation render units THEN `createDeckRenderPlan` SHALL throw.

## Requirement 2: Buzz Render Plan Completeness

**User Story:** As a buzz renderer, I want a buzz render plan with explicit template render units, so that symbols, vectors, boolean operations, and slide containers are not represented by a metadata-only stub.

#### Acceptance Criteria

1. WHEN `createBuzzRenderPlan` receives a buzz document THEN it SHALL produce a template outline for `SLIDE_GRID`, `SLIDE_ROW`, `SYMBOL`, `VECTOR`, and `BOOLEAN_OPERATION`.
2. WHEN the buzz document contains no template render units THEN `createBuzzRenderPlan` SHALL throw.

## Requirement 3: Site Render Plan Completeness

**User Story:** As a site renderer, I want a site render plan with explicit layout render units, so that CMS rich text, repeaters, responsive sets, symbols, and instances are not represented by a metadata-only stub.

#### Acceptance Criteria

1. WHEN `createSiteRenderPlan` receives a site document THEN it SHALL produce a layout outline for `CMS_RICH_TEXT`, `REPEATER`, `RESPONSIVE_SET`, `SYMBOL`, and `INSTANCE`.
2. WHEN the site document contains no layout render units THEN `createSiteRenderPlan` SHALL throw.
