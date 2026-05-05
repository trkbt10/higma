# Fig Validator Message Analyzer Design

## Scope

This spec maps directly to
`packages/@higma-document-io/fig/src/validator/message-analyzer.ts`.

## Design

`FieldInfo` and `MessageAnalysis` describe message analysis data.
`readVarUint`, `skipToNextField`, and `analyzeMessageData` inspect encoded
message bytes. `extractCanvasFromFig` extracts canvas bytes and
`extractMessageFromFig` extracts the fig message bytes from fig data for
validator IO. `analyzeMessageFormat` analyzes a fig file message format and
`compareMessageFormats` compares generated and reference fig file message
formats.

`compareMessageFormats` is the explicit validator IO operation for comparing
message formats of two fig files.

## Trace

- `FieldInfo` describes a field discovered during fig message analysis.
- `MessageAnalysis` summarizes fig message analysis output.
- `readVarUint` reads a variable-length unsigned integer from fig message data.
- `skipToNextField` advances message analysis to the next field marker.
- `analyzeMessageData` analyzes the structure of fig message data.
- `extractCanvasFromFig` extracts canvas data from fig validator input.
- `extractMessageFromFig` extracts message data from fig validator input.
- `analyzeMessageFormat` analyzes a fig file message format.
- `compareMessageFormats` compares message formats of two fig files.

## Drift Gate

`indexion spec align status .kiro/specs/fig-validator-message-analyzer/requirements.md packages/@higma-document-io/fig/src/validator/message-analyzer.ts --threshold 0.3 --fail-on any`
