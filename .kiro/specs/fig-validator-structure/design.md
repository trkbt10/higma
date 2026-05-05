# Fig Validator Structure Design

## Scope

This spec maps directly to
`packages/@higma-document-io/fig/src/validator/structure-validator.ts`.

## Design

`ValidationError` describes a fig structure validation error with validation
path and message output.

`ValidationResult` summarizes fig structure validation output with validation
success state and validation errors.

`validateFigFile` validates generated fig file bytes against reference fig file
bytes, compares their structure, and returns `ValidationResult`.

`getTypeName` resolves node type names for structure validation messages.
`REQUIRED_FIELDS` defines the required fig node field table per node type.

## Trace

- `ValidationError` describes a fig structure validation error.
- `ValidationResult` summarizes fig structure validation output.
- `validateFigFile` validates a generated fig file against a reference fig file.
- `getTypeName` provides node type names for structure validation messages.
- `REQUIRED_FIELDS` defines required fig node fields for structure validation.

## Drift Gate

`indexion spec align status .kiro/specs/fig-validator-structure/requirements.md packages/@higma-document-io/fig/src/validator/structure-validator.ts --threshold 0.3 --fail-on any`
