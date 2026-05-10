# Requirements Document

## Introduction

The autolayout-expansion feature shall expand Higma's Figma AutoLayout
coverage so generated `.fig` fixtures preserve Figma-authored AutoLayout
semantics and renderer output can be compared against Figma's own SVG export.
The feature covers canonical AutoLayout field authoring, fixture expansion,
renderer geometry parity, and verification harness behavior for AutoLayout
features that are currently unverified or affected by source-of-truth drift.

## Boundary Context

- **In scope**: Canonical Figma AutoLayout field names and values, expanded
  AutoLayout fixture cases, Figma round-trip validation, SVG geometry and render
  order comparison, and fail-fast detection of missing reference exports.
- **Out of scope**: Prototype interactions, animations, variant behavior,
  vector path tessellation accuracy, and Symbol/Instance override behavior for
  AutoLayout properties.
- **Adjacent expectations**: Figma Desktop and exported SVG files provide the
  visual source of truth for round-trip validation; this feature does not
  replace Figma's export workflow or broaden non-AutoLayout renderer coverage.

## Requirements

### Requirement 1: Canonical AutoLayout Authoring

**Objective:** As a fixture author, I want generated `.fig` nodes to use
canonical Figma AutoLayout field names and values, so that Figma Desktop loads
the fixture without silently changing the authored layout intent.

#### Acceptance Criteria

1. When a generated AutoLayout node represents grid layout, the Higma fig
   authoring workflow shall encode the stack mode as Figma's canonical GRID
   mode.
2. When a generated AutoLayout node represents wrapping, the Higma fig authoring
   workflow shall encode wrapping as the independent stack wrap setting without
   changing the stack mode.
3. When a generated AutoLayout node represents Hug contents sizing, the Higma
   fig authoring workflow shall encode the canonical resize-to-fit sizing value.
4. When a generated AutoLayout child represents Fill container behavior, the
   Higma fig authoring workflow shall encode that behavior as child primary
   growth rather than as a parent sizing enum.
5. When a generated AutoLayout node represents reverse canvas stacking, the
   Higma fig authoring workflow shall encode the canonical stack reverse z-index
   field.
6. If generated node data contains non-canonical AutoLayout names such as WRAP
   as a stack mode, FILL or HUG as stack-size enum names, or item reverse
   z-index, then the Higma fig authoring workflow shall fail validation before
   the fixture is accepted.

### Requirement 2: AutoLayout Feature Fixture Coverage

**Objective:** As a renderer maintainer, I want fixture coverage for the major
AutoLayout dimensions that affect layout geometry, so that renderer regressions
are visible against Figma exports.

#### Acceptance Criteria

1. When the AutoLayout fixture set is generated, the Higma fixture workflow
   shall include a grid fixture named `auto-grid-2x3` with two columns and three
   rows.
2. When the AutoLayout fixture set is generated, the Higma fixture workflow
   shall include a wrap fixture named `auto-wrap-3-rows` whose children flow
   into three rows.
3. When the AutoLayout fixture set is generated, the Higma fixture workflow
   shall include horizontal and vertical Hug contents fixtures named
   `auto-hug-h` and `auto-hug-v`.
4. When the AutoLayout fixture set is generated, the Higma fixture workflow
   shall include a Fill container growth fixture named `auto-fill-grow`.
5. When the AutoLayout fixture set is generated, the Higma fixture workflow
   shall include minimum and maximum clamp fixtures named `auto-min-clamp` and
   `auto-max-clamp`.
6. When the AutoLayout fixture set is generated, the Higma fixture workflow
   shall include an aspect-ratio lock fixture named `auto-aspect-lock`.
7. When the AutoLayout fixture set is generated, the Higma fixture workflow
   shall include stroke-in-layout variants named `auto-strokes-on` and
   `auto-strokes-off`.
8. When the AutoLayout fixture set is generated, the Higma fixture workflow
   shall include reverse z-order, absolute-position mix, asymmetric padding,
   nested AutoLayout, and counter-axis stretch fixtures named `auto-z-reverse`,
   `auto-absolute-mix`, `auto-padding-asym`, `auto-nested`, and
   `auto-stretch-counter`.

### Requirement 3: Figma Round-trip Preservation

**Objective:** As a fixture reviewer, I want each expanded fixture to preserve
its authored AutoLayout mode after opening in Figma Desktop, so that comparison
failures reflect renderer behavior instead of invalid fixture encoding.

#### Acceptance Criteria

1. When the generated `.fig` fixture is opened in Figma Desktop, the Higma
   fixture workflow shall preserve the intended grid, wrap, sizing, growth,
   min/max, aspect-ratio, stroke-in-layout, reverse z-order, absolute-position,
   padding, nested, and stretch settings.
2. If Figma Desktop changes an authored AutoLayout setting during round-trip,
   then the Higma fixture workflow shall reject the fixture until the encoded
   field names and values match Figma's source of truth.
3. When a fixture frame is approved after Figma round-trip, the Higma fixture
   workflow shall require a corresponding Figma-exported SVG reference for that
   frame.
4. If a required Figma-exported SVG reference is missing, then the Higma
   verification workflow shall fail instead of substituting a generated renderer
   snapshot.

### Requirement 4: AutoLayout Geometry Rendering

**Objective:** As a user of the SVG renderer, I want rendered AutoLayout
geometry to match Figma's export for covered AutoLayout features, so that
rendered documents preserve visible layout intent.

#### Acceptance Criteria

1. When the renderer processes a grid AutoLayout frame, the Higma SVG renderer
   shall place children on the same grid intersections as the Figma SVG export.
2. When the renderer processes a wrapping AutoLayout frame, the Higma SVG
   renderer shall place children into the same wrapped rows and cross-axis
   positions as the Figma SVG export.
3. When the renderer processes Hug contents sizing, the Higma SVG renderer
   shall render parent bounds that match the content-derived size shown in the
   Figma SVG export.
4. When the renderer processes Fill container growth, the Higma SVG renderer
   shall render the growing child at the remaining primary-axis size shown in
   the Figma SVG export.
5. When the renderer processes min/max-constrained Hug contents sizing, the
   Higma SVG renderer shall render parent bounds that match the clamped size
   shown in the Figma SVG export.
6. When the renderer processes strokes that contribute to layout, the Higma SVG
   renderer shall position children according to the same stroke-aware content
   area shown in the Figma SVG export.
7. When the renderer processes an AutoLayout child with absolute positioning,
   the Higma SVG renderer shall render flow children as if the absolute child
   does not consume primary-axis space.
8. When the renderer processes asymmetric padding, nested AutoLayout, or
   counter-axis stretch, the Higma SVG renderer shall match Figma's exported
   child positions and sizes for the covered fixture frames.

### Requirement 5: Render Order and Aspect Ratio Verification

**Objective:** As a renderer maintainer, I want verification to cover visual
properties beyond rectangle coordinates, so that AutoLayout regressions in
stacking and aspect ratio are detected.

#### Acceptance Criteria

1. When the verification workflow compares the `auto-z-reverse` fixture, the
   Higma verification workflow shall assert the rendered element order matches
   Figma's reverse stacking order.
2. When the verification workflow compares the `auto-aspect-lock` fixture, the
   Higma verification workflow shall assert the rendered frame preserves the
   authored 16:9 aspect ratio after resize behavior is exercised.
3. When the verification workflow compares stroke-in-layout variants, the Higma
   verification workflow shall distinguish the child positions for
   stroke-contributing and non-stroke-contributing layout.
4. When the verification workflow compares grid and min/max fixtures, the Higma
   verification workflow shall assert feature-specific geometry rather than only
   comparing stored document transforms.

### Requirement 6: End-to-end Verification Gate

**Objective:** As a maintainer, I want the expanded AutoLayout workflow to pass
generation, validation, and test gates, so that the feature is complete only
when fixtures and renderer output agree with Figma.

#### Acceptance Criteria

1. When canonical authoring changes are complete, the Higma workspace shall pass
   lint and typecheck for the affected packages.
2. When fixture generation runs, the Higma fixture workflow shall produce the
   expanded AutoLayout `.fig` fixture without non-canonical AutoLayout field
   names.
3. When Figma SVG references exist for every expanded fixture frame, the Higma
   AutoLayout verification spec shall pass for every layer in the expanded
   fixture map.
4. If renderer output differs from Figma's SVG export for a covered AutoLayout
   feature, then the Higma verification workflow shall fail and identify the
   affected fixture layer.
5. The Higma AutoLayout verification workflow shall include at least one
   fixture-and-spec pair for grid, wrap, Hug contents, Fill growth, min/max
   clamps, aspect-ratio lock, strokes contributing to layout, reverse z-order,
   absolute positioning, asymmetric padding, nested AutoLayout, and
   counter-axis stretch.
