# Implementation Plan

- [ ] 1. Establish the canonical AutoLayout contract foundation
- [ ] 1.1 Align AutoLayout schema constants with Figma's canonical source
  - Replace non-canonical stack mode, sizing, wrap, and reverse-order names with schema-backed canonical values.
  - Include grid, wrap, Hug sizing, min/max, aspect lock, stroke-in-layout, reverse z-order, and child growth fields in the shared contract.
  - The contract check fails when a constant diverges from the bundled Figma schema.
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 6.2_

- [ ] 1.2 Normalize domain and raw node AutoLayout data around canonical fields
  - Model wrap as an explicit stack wrap enum value and remove boolean or alias-based interpretation.
  - Carry canonical grid, sizing, growth, min/max, aspect lock, stroke-in-layout, reverse z-order, absolute-position, padding, nested, and stretch data through raw node conversion.
  - Raw node conversion throws when fixture-required AutoLayout values are absent instead of filling inferred values.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 3.1, 6.2_

- [ ] 2. Implement canonical fig authoring and validation
- [ ] 2.1 Serialize parent AutoLayout fields through canonical authoring builders
  - Author grid as canonical stack mode, wrap as independent stack wrap, Hug as canonical resize-to-fit sizing, and reverse stacking as the canonical reverse field.
  - Require explicit AutoLayout arguments for sizing, wrap, grid, padding, and stroke-in-layout behavior.
  - Generated parent AutoLayout nodes contain only canonical fields when inspected before encoding.
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 2.1, 2.2, 2.3, 2.5, 2.6, 2.7, 2.8, 6.2_

- [ ] 2.2 Serialize child AutoLayout behavior without parent-sizing aliases
  - Encode Fill container behavior through explicit child primary growth.
  - Preserve absolute-position children as non-flow participants while keeping their authored transforms.
  - Shape, text, frame, symbol, and raw node authoring produce observable child growth and positioning fields without `FILL` or `HUG` sizing aliases.
  - _Requirements: 1.4, 2.4, 2.8, 4.4, 4.7, 6.2_

- [ ] 2.3 Reject non-canonical AutoLayout node data before fixture acceptance
  - Detect `WRAP` as stack mode, `FILL` or `HUG` as stack-size enum names, item reverse z-index aliases, and boolean wrap values.
  - Report node-path-specific validation failures with the canonical field expected by the workflow.
  - Fixture generation fails before accepting any node that contains a rejected AutoLayout alias.
  - _Requirements: 1.6, 3.1, 3.2, 6.2_

- [ ] 2.4 (P) Register AutoLayout canonical lint coverage
  - Add lint findings for non-canonical aliases and missing fixture-required AutoLayout fields.
  - Register the rule so normal fig lint runs include AutoLayout canonical validation.
  - The lint report surfaces an error-severity finding for each intentionally malformed AutoLayout sample.
  - _Depends: 1.1_
  - _Requirements: 1.6, 3.1, 3.2, 6.2_
  - _Boundary: AutoLayoutCanonicalLintRule_

- [ ] 3. Expand the AutoLayout fixture manifest and generation workflow
- [ ] 3.1 Define the required AutoLayout fixture manifest
  - List exactly the required fixture layer names, feature categories, Figma reference SVG filenames, and explicit assertion types.
  - Validate layer-name uniqueness, reference-name uniqueness, and feature coverage before generation proceeds.
  - The manifest reports every required fixture case and fails if any required feature is absent.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 3.3, 6.5_

- [ ] 3.2 Generate expanded AutoLayout fixtures from the shared manifest
  - Produce grid, wrap, horizontal Hug, vertical Hug, Fill growth, min clamp, max clamp, aspect lock, stroke-on, stroke-off, reverse z-order, absolute mix, asymmetric padding, nested, and counter-axis stretch frames.
  - Use canonical authoring builders for every fixture case and run canonical lint as part of generation.
  - The generated AutoLayout fixture contains every manifest layer and no non-canonical AutoLayout fields.
  - _Depends: 2.1, 2.2, 2.3, 3.1_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 3.1, 6.2, 6.5_

- [ ] 3.3 Gate fixture approval on Figma reference exports
  - Require each approved manifest layer to have a corresponding Figma-exported SVG reference.
  - Fail when a required reference is absent instead of substituting renderer output or a generated snapshot.
  - The reference check identifies the missing layer name and expected reference path.
  - _Depends: 3.1_
  - _Requirements: 3.3, 3.4, 6.3, 6.4_

- [ ] 4. Resolve AutoLayout geometry for renderer parity
- [ ] 4.1 (P) Resolve flow positions for grid and wrap containers
  - Compute parent-local child rectangles for grid intersections, row wrapping, primary-axis spacing, cross-axis positioning, and asymmetric padding.
  - Throw when grid or wrap inputs required by the manifest are missing.
  - Renderer layout for grid and wrap fixture frames exposes child positions matching the manifest expectations.
  - _Depends: 1.2_
  - _Requirements: 4.1, 4.2, 4.8_
  - _Boundary: AutoLayoutLayoutResolver_

- [ ] 4.2 (P) Resolve Hug sizing, Fill growth, clamps, and aspect lock
  - Compute content-derived parent bounds, remaining-space child growth, min/max-constrained sizes, and authored aspect-ratio preservation.
  - Use only explicit node fields and source-of-truth layout inputs; missing sizing data fails fast.
  - Renderer layout for Hug, Fill growth, clamp, and aspect-lock fixtures exposes the expected parent and child rectangles.
  - _Depends: 1.2_
  - _Requirements: 4.3, 4.4, 4.5, 5.2, 5.4_
  - _Boundary: AutoLayoutLayoutResolver_

- [ ] 4.3 (P) Resolve stroke-aware, absolute, reverse, nested, and stretch behavior
  - Position children with and without stroke contribution, exclude absolute children from flow space, and preserve absolute transforms.
  - Apply reverse render order and counter-axis stretch after child layout is resolved.
  - Renderer layout for stroke, absolute mix, reverse z-order, nested, and counter-axis stretch fixtures exposes distinct positions, sizes, and render indices.
  - _Depends: 1.2_
  - _Requirements: 4.6, 4.7, 4.8, 5.1, 5.3_
  - _Boundary: AutoLayoutLayoutResolver_

- [ ] 4.4 Integrate the AutoLayout resolver into scene-graph rendering
  - Route AutoLayout frames through the centralized resolver before SVG rendering.
  - Remove duplicated builder-local primary-axis or stretch decisions that conflict with resolver output.
  - Rendered SVG output reflects resolver child rectangles and render indices for the expanded fixture set.
  - _Depends: 4.1, 4.2, 4.3_
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 5.1_

- [ ] 5. Build fail-fast AutoLayout verification
- [ ] 5.1 Verify manifest layers and reference SVGs before rendering comparisons
  - Fail when a manifest layer is absent from the generated fixture.
  - Fail when a required Figma SVG reference is absent.
  - Every setup failure names the affected fixture layer.
  - _Depends: 3.2, 3.3_
  - _Requirements: 3.3, 3.4, 6.3, 6.4, 6.5_

- [ ] 5.2 Compare renderer SVG geometry against Figma SVG geometry
  - Extract comparable rectangles and transforms from both renderer output and Figma reference SVGs.
  - Compare every manifest layer without skipping missing cases or falling back to stored document transforms alone.
  - A geometry mismatch fails with the layer name, assertion type, expected value, and rendered value.
  - _Depends: 4.4, 5.1_
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 6.4_

- [ ] 5.3 Add feature-specific verification assertions
  - Assert reverse render order for the reverse z-order fixture.
  - Assert 16:9 preservation for the aspect-lock fixture after resize behavior is exercised.
  - Distinguish stroke-on and stroke-off child positions and assert grid intersections plus clamp sizes explicitly.
  - Feature-specific assertion failures identify the affected layer.
  - _Depends: 5.2_
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 6.4, 6.5_

- [ ] 6. Add regression coverage and run completion gates
- [ ] 6.1 Add model contract and conversion unit coverage
  - Cover schema-aligned enum names, field names, reverse z-order naming, and canonical raw conversion.
  - Include negative samples for missing fixture-required AutoLayout fields.
  - Model tests fail when constants or conversion behavior drift from the canonical schema.
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 6.1, 6.2_

- [ ] 6.2 Add authoring builder and lint unit coverage
  - Cover canonical parent authoring, child growth authoring, non-canonical alias rejection, and fixture-required field validation.
  - Include malformed samples for `WRAP` stack mode, `FILL`, `HUG`, item reverse z-index, and boolean wrap.
  - IO tests fail on every forbidden alias and pass for canonical fixture node data.
  - _Requirements: 1.4, 1.6, 3.1, 3.2, 6.1, 6.2_

- [ ] 6.3 Add resolver unit coverage for every fixture-covered behavior
  - Cover grid, wrap, Hug, Fill growth, min/max clamp, aspect lock, stroke-in-layout, absolute child exclusion, asymmetric padding, nested layout, and counter-axis stretch.
  - Cover reverse render indices separately from geometry.
  - Resolver tests fail when required layout inputs are missing or when geometry differs from explicit expectations.
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 5.1_

- [ ] 6.4 Add end-to-end AutoLayout fixture verification coverage
  - Verify every manifest layer exists, every reference SVG exists, and every required feature has a fixture-and-spec pair.
  - Run geometry and feature-specific assertions for every expanded fixture frame.
  - The AutoLayout verification spec fails on missing references, missing layers, renderer mismatches, and missing feature coverage.
  - _Requirements: 3.3, 3.4, 5.1, 5.2, 5.3, 5.4, 6.3, 6.4, 6.5_

- [ ] 6.5 Run affected workspace gates with Bun
  - Run lint, typecheck, and test commands for the affected model, IO, and renderer packages.
  - Run fixture generation and AutoLayout verification after Figma reference SVGs are present.
  - Completion is observable when all affected Bun gates pass and any remaining failure points to a real fixture, reference, or renderer mismatch.
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
