# Fig Renderer IO Decouple Tasks

- [ ] Inventory direct imports from `@higma-document-io/fig` inside the fig
  renderer package.
- [ ] Classify each imported helper as domain-neutral conversion,
  renderer-specific conversion, or IO-only behavior.
- [ ] Extract shared conversion to one allowed source of truth, or move
  renderer-specific conversion into the renderer package.
- [ ] Update renderer source files to remove document IO imports.
- [ ] Update IO call sites if they now consume a lower shared conversion.
- [ ] Run renderer tests and typecheck.
- [ ] Run boundary lint and indexion drift gates.
