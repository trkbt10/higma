### Requirement 1: ChunkComparison

`ChunkComparison` shall describe comparison output for a pair of fig binary
chunks.

#### 1.1: Chunk comparison shape

WHEN validator IO compares fig binary chunks, THEN `ChunkComparison` SHALL
describe their equality and issues.

### Requirement 2: ComparisonResult

`ComparisonResult` shall summarize fig binary comparison output.

#### 2.1: Comparison result shape

WHEN binary comparison completes, THEN `ComparisonResult` SHALL contain
chunk-level comparison data and issues.

### Requirement 3: ZIP_MAGIC

`ZIP_MAGIC` shall define the ZIP container signature for fig binary
comparison.

#### 3.1: ZIP signature

WHEN binary comparison detects ZIP wrapping, THEN `ZIP_MAGIC` SHALL provide
the ZIP signature bytes.

### Requirement 4: ZSTD_MAGIC

`ZSTD_MAGIC` shall define the Zstandard signature for fig binary comparison.

#### 4.1: Zstandard signature

WHEN binary comparison detects Zstandard data, THEN `ZSTD_MAGIC` SHALL provide
the Zstandard signature bytes.

### Requirement 5: isZipFile

`isZipFile` shall detect ZIP-wrapped fig binary data.

#### 5.1: ZIP detection

WHEN binary comparison receives bytes, THEN `isZipFile` SHALL return whether
the bytes start with the ZIP signature.

### Requirement 6: isZstd

`isZstd` shall detect Zstandard-compressed fig binary data.

#### 6.1: Zstandard detection

WHEN binary comparison receives bytes, THEN `isZstd` SHALL return whether the
bytes start with the Zstandard signature.

### Requirement 7: extractCanvasData

`extractCanvasData` shall extract canvas bytes from fig binary data.

#### 7.1: Canvas data extraction

WHEN binary comparison receives fig data, THEN `extractCanvasData` SHALL
return the canvas bytes.

### Requirement 8: decompressChunk

`decompressChunk` shall decompress a fig binary chunk according to its
compression format.

#### 8.1: Chunk decompression

WHEN binary comparison receives compressed chunk bytes, THEN `decompressChunk`
SHALL return decompressed bytes.

### Requirement 9: getCompressionType

`getCompressionType` shall classify fig binary chunk compression.

#### 9.1: Compression classification

WHEN binary comparison receives chunk bytes, THEN `getCompressionType` SHALL
return the compression type.

### Requirement 10: readVarUint

`readVarUint` shall read a variable-length unsigned integer during binary
comparison.

#### 10.1: Binary varuint reader

WHEN binary comparison reads encoded bytes, THEN `readVarUint` SHALL return
the decoded unsigned integer and updated offset.

### Requirement 11: extractMessageFieldOrder

`extractMessageFieldOrder` shall extract field order from fig message bytes.

#### 11.1: Field order extraction

WHEN binary comparison reads message bytes, THEN `extractMessageFieldOrder`
SHALL return the field order.

### Requirement 12: compareBytes

`compareBytes` shall compare two byte arrays.

#### 12.1: Byte comparison

WHEN binary comparison compares generated and reference bytes, THEN
`compareBytes` SHALL return whether the bytes match.

### Requirement 13: safeDecompressPair

`safeDecompressPair` shall decompress generated and reference chunks and
record issues on failure.

#### 13.1: Pair decompression

WHEN binary comparison decompresses a pair of chunks, THEN `safeDecompressPair`
SHALL return decompressed bytes or record comparison issues.

### Requirement 14: compareFigFiles

`compareFigFiles` shall compare two fig files at the binary level.

#### 14.1: Fig binary comparison

WHEN validator IO receives generated and reference fig files, THEN
`compareFigFiles` SHALL return `ComparisonResult`.

### Requirement 15: runComparison

`runComparison` shall run fig binary comparison and report detailed output.

#### 15.1: Comparison runner

WHEN validator IO runs binary comparison, THEN `runComparison` SHALL execute
comparison and report the detailed result.
