### Requirement 1: FigImage

`FigImage` shall represent image data extracted by fig parser IO.

#### 1.1: Extracted image data

WHEN fig parser IO extracts image data from a fig file, THEN `FigImage` SHALL
represent the image hash and bytes without moving the image type into the
document model parser export.

### Requirement 2: assertFigImage

`assertFigImage` shall validate image data extracted by fig parser IO.

#### 2.1: Extracted image validation

WHEN fig parser IO validates extracted image data, THEN `assertFigImage` SHALL
throw a specific error for a missing image reference, missing image bytes, or
missing MIME type.
