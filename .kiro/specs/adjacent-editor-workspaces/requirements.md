# Requirements

## Requirement 1: Editor Workspace Render Unit Exposure

**User Story:** As a deck, buzz, or site editor, I want editor workspaces to expose render units and document diagnostics, so that editors are not only thin load-session wrappers.

#### Acceptance Criteria

1. WHEN an adjacent editor workspace is created THEN its overview SHALL include the render unit count from the renderer plan.
2. WHEN an adjacent editor workspace is created THEN its overview SHALL include schema definition names and node type names for inspector UI.
3. WHEN an adjacent editor workspace is created THEN its overview SHALL include metadata flags for render coordinates, thumbnail size, developer related links, and export timestamp.

## Requirement 2: Product-Specific Editor Boundaries

**User Story:** As a format maintainer, I want each adjacent editor package to own its product-specific workspace assembly, so that deck, buzz, and site editor work can proceed independently.

#### Acceptance Criteria

1. WHEN `createDeckEditorWorkspace` is called THEN it SHALL expose deck render units and deck presentation summary.
2. WHEN `createBuzzEditorWorkspace` is called THEN it SHALL expose buzz render units and buzz template summary.
3. WHEN `createSiteEditorWorkspace` is called THEN it SHALL expose site render units and site layout summary.

## Requirement 3: Product-Specific Editor Sessions

**User Story:** As a format maintainer, I want product-specific editor session constructors, so that each adjacent editor can be opened and tested independently without sharing sibling editor code.

#### Acceptance Criteria

1. WHEN `createDeckEditorSession` is called THEN it SHALL create a `DeckEditorSession` tagged with the deck kind and deck insights.
2. WHEN `createBuzzEditorSession` is called THEN it SHALL create a `BuzzEditorSession` tagged with the buzz kind and buzz insights.
3. WHEN `createSiteEditorSession` is called THEN it SHALL create a `SiteEditorSession` tagged with the site kind and site insights.
