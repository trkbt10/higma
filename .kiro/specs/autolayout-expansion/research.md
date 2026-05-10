# Research & Design Decisions

## Summary
- **Feature**: `autolayout-expansion`
- **Discovery Scope**: Extension
- **Key Findings**:
  - The bundled canonical schema in `packages/@higma-document-io/fig/src/fig-file/figma-schema.json` already exposes `StackMode.GRID`, `StackSize.RESIZE_TO_FIT_WITH_IMPLICIT_SIZE`, `stackReverseZIndex`, `StackWrap`, grid sizing fields, and min/max size fields. Several authoring helpers still use older local names such as `WRAP`, `FILL`, `HUG`, and `itemReverseZIndex`.
  - The renderer has partial AutoLayout support split across `src/scene-graph/autolayout-primary.ts` and counter-axis stretch logic in `src/scene-graph/builder.ts`. The current scope must consolidate geometry decisions into one AutoLayout layout resolver instead of adding per-fixture patches.
  - `packages/@higma-document-renderers/fig/spec/autolayout.spec.ts` currently skips missing layers or missing Figma SVG exports. The expanded fixture gate must fail fast when a required layer or reference export is absent.

## Research Log

### Canonical AutoLayout Schema
- **Context**: Requirements 1 and 3 require generated `.fig` files to preserve Figma-authored AutoLayout semantics.
- **Sources Consulted**:
  - `packages/@higma-document-io/fig/src/fig-file/figma-schema.json`
  - `packages/@higma-document-models/fig/src/constants/layout.ts`
  - `packages/@higma-document-io/fig/src/fig-file/schema/text-schema.ts`
  - `packages/@higma-document-io/fig/src/fig-file/frame/frame.ts`
- **Findings**:
  - Canonical `StackMode` value 3 is named `GRID`, not `WRAP`.
  - Canonical Hug contents sizing is `StackSize.RESIZE_TO_FIT_WITH_IMPLICIT_SIZE`.
  - Canonical Fill container growth is represented by child `stackChildPrimaryGrow`, not a stack-size enum named `FILL`.
  - Canonical reverse stacking field is `stackReverseZIndex`; existing builder and domain surfaces still mention `itemReverseZIndex`.
  - Canonical wrapping is a `StackWrap` enum, not a parent stack mode.
- **Implications**:
  - Canonical schema constants must be the authoring SoT.
  - Builder APIs may keep ergonomic method names only when their serialized field names and enum values are canonical.
  - Lint validation must reject non-canonical AutoLayout names before fixtures are accepted.

### Existing Fixture and Verification Pattern
- **Context**: Requirements 2, 3, 5, and 6 require expanded fixture coverage and Figma SVG reference comparison.
- **Sources Consulted**:
  - `packages/@higma-document-renderers/fig/spec/autolayout.spec.ts`
  - `packages/@higma-document-renderers/fig/fixtures/autolayout`
  - `packages/@higma-document-renderers/fig/scripts/generate-layout-fixtures.ts`
  - `packages/@higma-document-io/fig/src/lint`
- **Findings**:
  - Existing AutoLayout tests map layer names to SVG reference files.
  - Missing layers and missing reference SVG files currently log and return, which hides incomplete fixture coverage.
  - A fig lint pipeline exists and can host AutoLayout canonical-name validation without introducing a new package.
- **Implications**:
  - The fixture map should become an explicit typed manifest consumed by generation and verification.
  - Missing manifest entries, missing layers, and missing SVG references should be errors.
  - The lint rule must be part of the fixture generation gate and package tests.

### Renderer AutoLayout Geometry
- **Context**: Requirement 4 expands renderer parity beyond current primary-axis and stretch cases.
- **Sources Consulted**:
  - `packages/@higma-document-renderers/fig/src/scene-graph/autolayout-primary.ts`
  - `packages/@higma-document-renderers/fig/src/scene-graph/builder.ts`
  - `packages/@higma-document-renderers/fig/src/scene-graph/autolayout-stretch.spec.ts`
- **Findings**:
  - Primary-axis distribution supports horizontal and vertical stacks, padding, spacing, alignment, absolute children, and child grow.
  - Counter-axis stretch exists separately in builder code.
  - Wrap, grid, Hug parent sizing, min/max clamp, aspect lock, stroke-in-layout, reverse z-order, and nested composition are not represented as one coherent layout contract.
- **Implications**:
  - A single AutoLayout layout resolver should own resolved child order, positions, sizes, and parent Hug sizing for renderer consumption.
  - Existing primary-axis and stretch code should be folded into or delegated from that resolver to avoid source-of-truth duplication.

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| Patch current fixture spec | Add names and assertions inside `autolayout.spec.ts` only | Small change | Leaves non-canonical authoring and renderer drift undetected | Rejected because it does not satisfy 1.x and 4.x |
| Schema-contract plus resolver | Make canonical schema fields explicit, add lint validation, expand fixtures, and centralize renderer AutoLayout resolution | Clear ownership, fail-fast gates, reusable renderer behavior | Requires coordinated changes across IO, model, renderer, and tests | Selected |
| External layout engine | Adopt a CSS flex/grid engine for renderer geometry | Potentially mature algorithms | Figma Kiwi fields do not map cleanly, grid and source-of-truth round-trip still custom | Rejected for current scope |

## Design Decisions

### Decision: Use the bundled Figma schema as AutoLayout field SoT
- **Context**: Multiple local constants diverge from canonical schema names.
- **Alternatives Considered**:
  1. Keep old local names and translate at serialization time.
  2. Replace authoring and validation surfaces with canonical schema names.
- **Selected Approach**: Canonical constants and domain fields match `figma-schema.json`; non-canonical aliases are rejected by lint.
- **Rationale**: Translation aliases hide invalid fixture authoring and make round-trip failures hard to diagnose.
- **Trade-offs**: Existing helper methods must be updated, but validation becomes direct and auditable.
- **Follow-up**: Add focused specs for constants, builders, document conversion, and lint failures.

### Decision: Build a project-owned AutoLayout resolver
- **Context**: Renderer geometry needs Figma parity for the covered fixture set.
- **Alternatives Considered**:
  1. Keep separate helper functions for each new case.
  2. Build one resolver contract for flow, wrap, grid, Hug, grow, clamp, stroke, absolute children, and z-order.
- **Selected Approach**: Create one renderer-owned resolver that returns resolved parent and child layout for scene-graph construction.
- **Rationale**: Requirements exercise interacting layout features, so per-case helpers would duplicate axis, padding, and child filtering rules.
- **Trade-offs**: The resolver is broader than the existing helper, but its scope is limited to fixture-covered AutoLayout behavior.
- **Follow-up**: Preserve existing primary-axis and stretch tests while adding fixture-specific tests for every new requirement.

### Decision: Verification fails on missing references
- **Context**: Current AutoLayout verification logs and returns when a layer or Figma SVG export is missing.
- **Alternatives Considered**:
  1. Continue skip behavior to keep partial fixture work green.
  2. Require every manifest layer and reference SVG before the spec passes.
- **Selected Approach**: The manifest is authoritative; missing layers, actual SVG references, or feature assertions fail the spec.
- **Rationale**: Requirements 3.3, 3.4, and 6.3 require Figma exports as the visual source of truth.
- **Trade-offs**: Fixture expansion cannot land without reference exports, but incomplete verification is visible immediately.
- **Follow-up**: Add a dedicated manifest coverage assertion before per-layer render comparison.

## Risks & Mitigations
- Canonical schema changes can invalidate local constants - add a spec that compares AutoLayout constants against `figma-schema.json`.
- Figma Desktop reference export is a manual prerequisite - make missing SVG references fail with the exact frame name and path.
- Renderer grid and wrap logic may interact with child grow and absolute positioning - use the manifest to keep fixture cases isolated and feature-specific.
- Existing tests may rely on old `FILL` or `HUG` enum names - update callers to use `stackChildPrimaryGrow` for Fill and canonical StackSize names for Hug.

## References
- `packages/@higma-document-io/fig/src/fig-file/figma-schema.json` - canonical Kiwi schema.
- `packages/@higma-document-models/fig/src/constants/layout.ts` - existing local layout constants to align.
- `packages/@higma-document-renderers/fig/spec/autolayout.spec.ts` - existing AutoLayout SVG comparison harness.
- `packages/@higma-document-renderers/fig/src/scene-graph/autolayout-primary.ts` - existing primary-axis resolver.
