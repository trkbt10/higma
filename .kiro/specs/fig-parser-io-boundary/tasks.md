# Fig Parser IO Boundary Tasks

- [ ] Inventory current fig parser and validator exports and classify each
  exported symbol as domain-only or IO-owned.
- [ ] Move IO-owned parser and validator implementation into
  `@higma-document-io/fig`.
- [ ] Update parser and validator package exports on `@higma-document-io/fig`.
- [ ] Remove parser and validator exports from `@higma-document-models/fig`
  without compatibility re-exports.
- [ ] Update all consumers to import parser and validator APIs from document IO
  or a lower domain-only helper when applicable.
- [ ] Run unit tests covering parser and validator behavior.
- [ ] Run typecheck, lint boundary checks, and indexion drift gates.
