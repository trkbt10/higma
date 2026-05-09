/**
 * @file Recursive directory walker tests.
 *
 * Exercises the file-classification rules and recursion safety
 * (symlink skip, depth cap) without relying on the real host
 * filesystem.
 */

import { classifyFontFile, scanFontDirectories } from "./discover-dirs";
import { createFakeFs } from "./test-helpers";

describe("classifyFontFile", () => {
  it("recognises the four extensions opentype.js can parse directly", () => {
    expect(classifyFontFile("Helvetica.ttf")).toBe("parseable");
    expect(classifyFontFile("Helvetica.otf")).toBe("parseable");
    expect(classifyFontFile("Helvetica.ttc")).toBe("parseable");
    expect(classifyFontFile("Helvetica.woff")).toBe("parseable");
  });

  it("flags woff2 as a recognised-but-unsupported encoding", () => {
    expect(classifyFontFile("Inter.woff2")).toBe("woff2");
  });

  it("treats every other extension as unknown", () => {
    expect(classifyFontFile("README.md")).toBe("unknown");
    expect(classifyFontFile("font.dfont")).toBe("unknown");
    expect(classifyFontFile("font.pfb")).toBe("unknown");
    expect(classifyFontFile("font.afm")).toBe("unknown");
  });

  it("ignores case so MacOS-style mixed extensions still match", () => {
    expect(classifyFontFile("Helvetica.TTF")).toBe("parseable");
    expect(classifyFontFile("Helvetica.WOFF2")).toBe("woff2");
  });
});

describe("scanFontDirectories", () => {
  it("returns parseable files only and skips woff2 / unknown siblings", () => {
    const fs = createFakeFs();
    fs.putFile("/fonts/Inter.ttf", new Uint8Array([0]));
    fs.putFile("/fonts/Inter.woff2", new Uint8Array([0]));
    fs.putFile("/fonts/notes.txt", new Uint8Array([0]));

    const result = scanFontDirectories(fs, ["/fonts"]);

    expect(result.map((f) => f.path)).toEqual(["/fonts/Inter.ttf"]);
  });

  it("descends into subdirectories — Apple's Supplemental layout", () => {
    const fs = createFakeFs();
    fs.putFile("/System/Library/Fonts/Helvetica.ttc", new Uint8Array([0]));
    fs.putFile("/System/Library/Fonts/Supplemental/Arial.ttf", new Uint8Array([0]));
    fs.putFile("/System/Library/Fonts/Supplemental/Times New Roman.ttf", new Uint8Array([0]));

    const result = scanFontDirectories(fs, ["/System/Library/Fonts"]);

    expect(new Set(result.map((f) => f.path))).toEqual(
      new Set([
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Times New Roman.ttf",
      ]),
    );
  });

  it("skips symlinks unconditionally to avoid loops", () => {
    const fs = createFakeFs();
    fs.putFile("/fonts/real.ttf", new Uint8Array([0]));
    fs.putSymlink("/fonts/loop", "/fonts");
    fs.putSymlink("/fonts/Helvetica.ttf", "/system/Helvetica.ttf");

    const result = scanFontDirectories(fs, ["/fonts"]);

    // The symlinked TTF is rejected even though its name looks
    // parseable — discovery must not follow links.
    expect(result.map((f) => f.path)).toEqual(["/fonts/real.ttf"]);
  });

  it("skips a non-existent root rather than throwing", () => {
    const fs = createFakeFs();
    expect(scanFontDirectories(fs, ["/does/not/exist"])).toEqual([]);
  });

  it("dedupes when the same root is passed twice", () => {
    const fs = createFakeFs();
    fs.putFile("/a/x.ttf", new Uint8Array([0]));

    const result = scanFontDirectories(fs, ["/a", "/a"]);

    expect(result.map((f) => f.path)).toEqual(["/a/x.ttf"]);
  });

  it("caps recursion to keep deeply-nested layouts bounded", () => {
    const fs = createFakeFs();
    // Build /d0/d1/.../d12/leaf.ttf — leaf is well past the cap.
    const segments = Array.from({ length: 13 }, (_, i) => `d${i}`);
    const leafDir = segments.reduce<string>((acc, seg) => {
      const next = `${acc}/${seg}`;
      fs.putDir(next);
      return next;
    }, "");
    fs.putFile(`${leafDir}/leaf.ttf`, new Uint8Array([0]));

    const result = scanFontDirectories(fs, ["/d0"]);

    // The walker stops descending past depth 8, so a leaf at depth
    // 13 is unreachable. Real font dirs nest two or three deep at
    // most — anything past that suggests a misconfigured user
    // import we explicitly choose not to chase.
    expect(result).toEqual([]);
  });
});
