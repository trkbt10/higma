### Requirement 1: FieldInfo

`FieldInfo` shall describe a field discovered during fig message analysis.

#### 1.1: Field information

WHEN validator IO analyzes message data, THEN `FieldInfo` SHALL describe the
field identifier and position information.

### Requirement 2: MessageAnalysis

`MessageAnalysis` shall summarize fig message analysis output.

#### 2.1: Message analysis summary

WHEN validator IO completes message analysis, THEN `MessageAnalysis` SHALL
contain the analyzed field information and summary data.

### Requirement 3: readVarUint

`readVarUint` shall read a variable-length unsigned integer from fig message
data.

#### 3.1: Varuint reader

WHEN validator IO reads encoded message data, THEN `readVarUint` SHALL return
the decoded unsigned integer and updated offset.

### Requirement 4: skipToNextField

`skipToNextField` shall advance message analysis to the next field marker.

#### 4.1: Field marker skip

WHEN validator IO needs to continue message analysis after unknown bytes, THEN
`skipToNextField` SHALL locate the next field marker.

### Requirement 5: analyzeMessageData

`analyzeMessageData` shall analyze the structure of fig message data.

#### 5.1: Message data analysis

WHEN validator IO receives message bytes, THEN `analyzeMessageData` SHALL
produce `MessageAnalysis`.

### Requirement 6: extractCanvasFromFig

`extractCanvasFromFig` shall extract canvas data from fig validator input.

#### 6.1: Canvas extraction

WHEN validator IO receives fig data, THEN `extractCanvasFromFig` SHALL return
the canvas bytes while handling container wrapping.

### Requirement 7: extractMessageFromFig

`extractMessageFromFig` shall extract message data from fig validator input.

#### 7.1: Message extraction

WHEN validator IO receives fig data, THEN `extractMessageFromFig` SHALL return
the fig message bytes.

### Requirement 8: analyzeMessageFormat

`analyzeMessageFormat` shall analyze a fig file message format.

#### 8.1: Message format analysis

WHEN validator IO receives a fig file, THEN `analyzeMessageFormat` SHALL
produce message format analysis.

### Requirement 9: compareMessageFormats

`compareMessageFormats` shall compare message formats of two fig files.

#### 9.1: Message format comparison

WHEN validator IO receives generated and reference fig files, THEN
`compareMessageFormats` SHALL compare their message formats.
