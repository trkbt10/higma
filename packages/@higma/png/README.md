# @higma/png

Pure TypeScript PNG encoder/decoder. Environment-independent (works in both Node.js and browser).

## API

### encodeRgbaToPng

Encode RGBA pixel data to PNG bytes.

```typescript
import { encodeRgbaToPng } from "@higma/png";

const rgba = new Uint8ClampedArray(100 * 100 * 4); // 100x100 image
// ... fill rgba with pixel data ...

const pngBytes = encodeRgbaToPng(rgba, 100, 100);
```

### encodeRgbaToPngDataUrl

Encode RGBA pixel data to PNG data URL.

```typescript
import { encodeRgbaToPngDataUrl } from "@higma/png";

const dataUrl = encodeRgbaToPngDataUrl(rgba, 100, 100);
// "data:image/png;base64,..."
```

### createPngImage

Create an empty RGBA image filled with zeros.

```typescript
import { createPngImage } from "@higma/png";

const image = createPngImage({ width: 100, height: 100 });
// image.data is Uint8Array of 100 * 100 * 4 bytes

// Draw a red pixel at (0, 0)
image.data[0] = 255; // R
image.data[1] = 0;   // G
image.data[2] = 0;   // B
image.data[3] = 255; // A
```

### readPng

Decode a PNG buffer into a PngImage.

```typescript
import { readPng } from "@higma/png";

const buffer = await Bun.file("image.png").bytes();
const image = readPng(buffer);
// image.width, image.height, image.data
```

### writePng

Encode a PngImage into a PNG buffer.

```typescript
import { writePng } from "@higma/png";

const pngBytes = writePng(image);
await Bun.write("output.png", pngBytes);
```

### isPng

Check if a buffer starts with PNG signature.

```typescript
import { isPng } from "@higma/png";

isPng(buffer); // true if starts with PNG magic bytes
```

## Types

### PngImage

```typescript
type PngImage = {
  readonly width: number;
  readonly height: number;
  data: Uint8Array; // RGBA, 4 bytes per pixel, row-major
};
```
