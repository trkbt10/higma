# @higma/zip

ZIP archive read/write operations using fflate. Used for `.fig` files (which are ZIP archives) and OPC packages.

## API

### loadZipPackage

Load a ZIP package from a buffer.

```typescript
import { loadZipPackage } from "@higma/zip";

const buffer = await Bun.file("file.zip").arrayBuffer();
const pkg = await loadZipPackage(buffer);

// Read text file
const content = pkg.readText("path/to/file.txt");

// Read binary file
const binary = pkg.readBinary("path/to/image.png");

// Check existence
pkg.exists("path/to/file.txt"); // true

// List all files
pkg.listFiles(); // ["path/to/file.txt", "path/to/image.png", ...]
```

### createEmptyZipPackage

Create an empty ZIP package for building archives.

```typescript
import { createEmptyZipPackage } from "@higma/zip";

const pkg = createEmptyZipPackage();

// Write text file
pkg.writeText("meta.json", JSON.stringify({ name: "test" }));

// Write binary file
pkg.writeBinary("image.png", imageData);

// Remove file
pkg.remove("unwanted.txt");

// Export as ArrayBuffer
const buffer = await pkg.toArrayBuffer({ compressionLevel: 6 });

// Export as Blob
const blob = await pkg.toBlob({ mimeType: "application/zip" });
```

### isBinaryFile

Check if a file path is a binary file (based on extension).

```typescript
import { isBinaryFile } from "@higma/zip";

isBinaryFile("image.png");  // true
isBinaryFile("data.json");  // false
```

## Types

### ZipPackage

```typescript
type ZipPackage = {
  // Read
  readText(path: string): string | null;
  readBinary(path: string): ArrayBuffer | null;
  exists(path: string): boolean;
  listFiles(): readonly string[];

  // Write
  writeText(path: string, content: string): void;
  writeBinary(path: string, content: ArrayBuffer | Uint8Array): void;
  remove(path: string): void;

  // Export
  toBlob(options?: ZipGenerateOptions): Promise<Blob>;
  toArrayBuffer(options?: ZipGenerateOptions): Promise<ArrayBuffer>;
};
```

### ZipGenerateOptions

```typescript
type ZipGenerateOptions = {
  compressionLevel?: number; // 0-9, default: 6
  mimeType?: string;
};
```
