### Requirement 1: ValidationError

`ValidationError` shall describe a fig structure validation error.

#### 1.1: Validation error shape

WHEN structure validation detects invalid fig data, THEN `ValidationError`
SHALL describe the validation path and message.

### Requirement 2: ValidationResult

`ValidationResult` shall summarize fig structure validation output.

#### 2.1: Validation result shape

WHEN structure validation completes, THEN `ValidationResult` SHALL contain the
validation success state and validation errors.

### Requirement 3: validateFigFile

`validateFigFile` shall validate a generated fig file against a reference fig
file.

#### 3.1: Fig structure validation

WHEN validator IO receives generated and reference fig file bytes, THEN
`validateFigFile` SHALL compare their structure and return `ValidationResult`.

### Requirement 4: getTypeName

`getTypeName` shall provide node type names for structure validation messages.

#### 4.1: Type name resolution

WHEN structure validation reports node fields, THEN `getTypeName` SHALL return
the node type name.

### Requirement 5: REQUIRED_FIELDS

`REQUIRED_FIELDS` shall define required fig node fields for structure
validation.

#### 5.1: Required fields table

WHEN structure validation checks node completeness, THEN `REQUIRED_FIELDS`
SHALL provide the required field set per node type.
