### Requirement 1: decompressDeflate

`decompressDeflate` shall decompress zlib-wrapped deflate data for fig parser
IO and throw parser decompression errors on failure.

#### 1.1: Zlib deflate decompression

WHEN fig parser IO receives zlib-wrapped deflate data, THEN
`decompressDeflate` SHALL return decompressed bytes or throw a specific error.

### Requirement 2: decompressDeflateRaw

`decompressDeflateRaw` shall decompress raw deflate data for fig parser IO.

#### 2.1: Raw deflate decompression

WHEN fig parser IO receives raw fig-kiwi deflate data, THEN
`decompressDeflateRaw` SHALL return decompressed bytes or throw a specific
error.

### Requirement 3: decompressZstd

`decompressZstd` shall decompress Zstandard data for fig parser IO.

#### 3.1: Zstandard decompression

WHEN fig parser IO receives Zstandard data, THEN `decompressZstd` SHALL return
decompressed bytes or throw a specific error.
