# Requirements

## Requirement 1: Product-Free Render Outline Extraction

**User Story:** As a fig-family renderer, I want a product-free render outline extractor, so that deck, buzz, site, and fig-adjacent renderers can share raw Kiwi node traversal without importing each other.

#### Acceptance Criteria

1. WHEN `createFigmaRenderOutline` receives decoded fig-family node changes THEN it SHALL extract render outline entries from the explicitly supplied node type roles.
2. WHEN a render outline entry is emitted THEN it SHALL preserve the node guid, node type, name, parent guid, child guids, source order, and tree depth.
3. WHEN a selected render outline node lacks a valid guid THEN `createFigmaRenderOutline` SHALL throw instead of inventing an identifier.

## Requirement 2: Explicit Outline Role Selection

**User Story:** As a format-specific renderer, I want explicit role selection, so that presentation, template, and site rendering units are not hidden behind a common fallback.

#### Acceptance Criteria

1. WHEN `createFigmaRenderOutline` receives role definitions THEN it SHALL emit only nodes whose node type is present in those role definitions.
2. WHEN a role definition maps a node type to a render role THEN emitted entries SHALL carry that render role.
3. WHEN a node carries a parentIndex guid THEN depth SHALL be computed from the decoded guid graph rather than from array position.

## Requirement 3: Raw Node Guards

**User Story:** As a product-free extractor, I want explicit raw value guards, so that unknown Kiwi values do not become implicit renderer defaults.

#### Acceptance Criteria

1. WHEN a decoded node value is inspected THEN `asRecord` SHALL accept only object records and SHALL return null for non-object values.
2. WHEN a decoded node type is inspected THEN `readNodeType` SHALL read string node types and enum-object `name` node types.
3. WHEN a decoded node name is inspected THEN `readName` SHALL return only string names and SHALL return null for non-string names.

## Requirement 4: Guid Address Extraction

**User Story:** As a render outline consumer, I want guid extraction to be a single product-free path, so that render entries do not invent ids differently per renderer.

#### Acceptance Criteria

1. WHEN a raw guid value is inspected THEN `readGuid` SHALL accept only numeric `sessionID` and numeric `localID`.
2. WHEN a raw guid is serialized THEN `guidToString` SHALL return the stable `sessionID:localID` identifier.
3. WHEN a decoded node guid is inspected THEN `readNodeGuid` SHALL return a serialized guid or null.
4. WHEN a decoded parentIndex guid is invalid THEN `readParentGuid` SHALL throw.

## Requirement 5: Graph Collection

**User Story:** As a render outline extractor, I want graph collection to be explicit, so that parent and child relationships are not inferred from node array position.

#### Acceptance Criteria

1. WHEN role definitions are indexed THEN `rolesByNodeType` SHALL create the node type to role lookup used by outline selection.
2. WHEN decoded nodes are indexed THEN `collectNodeIds` SHALL collect every valid decoded node guid.
3. WHEN decoded nodes are indexed THEN `collectChildIds` SHALL collect child guid arrays keyed by parent guid.
4. WHEN decoded nodes are indexed THEN `collectParentIds` SHALL collect parent guid references and SHALL throw when a referenced parent guid is absent.

## Requirement 6: Depth Calculation

**User Story:** As a renderer, I want depth to come from the guid parent graph, so that render order and hierarchy remain independent of storage order.

#### Acceptance Criteria

1. WHEN `computeDepth` receives a root guid THEN it SHALL return depth zero.
2. WHEN `computeDepth` receives a child guid THEN it SHALL count parent links in the decoded parent map.
3. WHEN `computeDepth` detects a parent cycle THEN it SHALL throw.
