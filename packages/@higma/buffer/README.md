# @higma/buffer

Binary data utilities for base64 encoding, data URL handling, and size formatting.

## API

### base64ArrayBuffer

Convert `ArrayBuffer` to base64 string.

```typescript
import { base64ArrayBuffer } from "@higma/buffer";

const buffer = new Uint8Array([72, 101, 108, 108, 111]).buffer;
const base64 = base64ArrayBuffer(buffer); // "SGVsbG8="
```

### base64ToArrayBuffer

Convert base64 string to `ArrayBuffer`.

```typescript
import { base64ToArrayBuffer } from "@higma/buffer";

const buffer = base64ToArrayBuffer("SGVsbG8=");
new Uint8Array(buffer); // [72, 101, 108, 108, 111]
```

### toDataUrl

Convert `ArrayBuffer` to data URL with MIME type.

```typescript
import { toDataUrl } from "@higma/buffer";

const dataUrl = toDataUrl(buffer, "image/png");
// "data:image/png;base64,..."
```

### parseDataUrl

Parse data URL to extract MIME type and binary data.

```typescript
import { parseDataUrl } from "@higma/buffer";

const { mimeType, data } = parseDataUrl("data:image/png;base64,iVBOR...");
// mimeType: "image/png"
// data: ArrayBuffer
```

### formatSize

Format byte count as human-readable string.

```typescript
import { formatSize } from "@higma/buffer";

formatSize(1024);      // "1.0 KB"
formatSize(1048576);   // "1.0 MB"
formatSize(undefined); // "—"
```
