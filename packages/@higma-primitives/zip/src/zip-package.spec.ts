/**
 * @file Tests for format ZIP packages
 */

import { createEmptyZipPackage, isBinaryFile, loadZipPackage } from "./zip-package";

describe("format ZIP package", () => {
  it("roundtrips text and binary entries", async () => {
    const packageFile = createEmptyZipPackage();
    packageFile.writeText("meta.json", "{\"name\":\"demo\"}");
    packageFile.writeBinary("images/a.bin", new Uint8Array([1, 2, 3]));

    const reloaded = await loadZipPackage(await packageFile.toArrayBuffer());

    expect([...reloaded.listFiles()].sort()).toEqual(["images/a.bin", "meta.json"]);
    expect(reloaded.readText("meta.json")).toBe("{\"name\":\"demo\"}");
    expect(new Uint8Array(reloaded.readBinary("images/a.bin") ?? new ArrayBuffer(0))).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it("rejects invalid compression levels", async () => {
    const packageFile = createEmptyZipPackage();
    packageFile.writeText("canvas.fig", "data");

    await expect(packageFile.toArrayBuffer({ compressionLevel: 10 })).rejects.toThrow(
      "compressionLevel must be an integer 0-9",
    );
  });

  it("exposes a read-only adapter over the same entries", () => {
    const packageFile = createEmptyZipPackage();
    const readable = packageFile.asReadablePackage();

    packageFile.writeText("late.txt", "content");

    expect(readable.readText("late.txt")).toBe("content");
    expect(readable.exists("late.txt")).toBe(true);
    expect(readable.listFiles?.()).toContain("late.txt");
  });

  it("identifies common binary payload paths", () => {
    expect(isBinaryFile("image.png")).toBe(true);
    expect(isBinaryFile("Photo.JPG")).toBe(true);
    expect(isBinaryFile("slide.xml")).toBe(false);
    expect(isBinaryFile("folder/file")).toBe(false);
  });
});
