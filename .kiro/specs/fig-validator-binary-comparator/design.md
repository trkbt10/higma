# Fig Validator Binary Comparator Design

## Scope

This spec maps directly to
`packages/@higma-document-io/fig/src/validator/binary-comparator.ts`.

### Requirement 1: ChunkComparison

`ChunkComparison` describes comparison output for a pair of fig binary chunks.

### Requirement 2: ComparisonResult

`ComparisonResult` summarizes fig binary comparison output with chunk-level
comparison data and issues.

### Requirement 3: ZIP_MAGIC

`ZIP_MAGIC` defines the ZIP container signature for fig binary comparison.

### Requirement 4: ZSTD_MAGIC

`ZSTD_MAGIC` defines the Zstandard signature for fig binary comparison.

### Requirement 5: isZipFile

`isZipFile` detects ZIP-wrapped fig binary data.

### Requirement 6: isZstd

`isZstd` detects Zstandard-compressed fig binary data.

### Requirement 7: extractCanvasData

`extractCanvasData` extracts canvas bytes from fig binary data.

### Requirement 8: decompressChunk

`decompressChunk` decompresses a fig binary chunk according to its compression
format.

### Requirement 9: getCompressionType

`getCompressionType` classifies fig binary chunk compression.

### Requirement 10: readVarUint

`readVarUint` reads a variable-length unsigned integer during binary
comparison.

### Requirement 11: extractMessageFieldOrder

`extractMessageFieldOrder` extracts field order from fig message bytes.

### Requirement 12: compareBytes

`compareBytes` compares two byte arrays.

### Requirement 13: safeDecompressPair

`safeDecompressPair` decompresses generated and reference chunks and records
issues on failure.

### Requirement 14: compareFigFiles

`compareFigFiles` compares two fig files at the binary level.

### Requirement 15: runComparison

`runComparison` runs fig binary comparison and reports detailed output.

## Drift Gate

`indexion spec align status .kiro/specs/fig-validator-binary-comparator/requirements.md packages/@higma-document-io/fig/src/validator/binary-comparator.ts --threshold 0.3 --fail-on any`
