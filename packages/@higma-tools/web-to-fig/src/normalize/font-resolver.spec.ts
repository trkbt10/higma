/**
 * @file Unit tests for the `font-family` stack tokeniser.
 *
 * `parseFontStack` is a small, deterministic function used by every
 * code path that touches `font-family` — getting it wrong silently
 * corrupts the IR's text style and reproducing the bug downstream is
 * expensive (full Playwright capture + diff loop). The tests below
 * pin the per-character behaviour explicitly so a future tweak to the
 * tokeniser can't quietly drop a quoted comma or miscategorise a
 * generic keyword.
 */
import {
  UnresolvedFontStackError,
  parseFontStack,
  type FontStackCandidate,
} from "./font-resolver";

describe("parseFontStack", () => {
  it("splits a plain comma-separated stack in source order", () => {
    expect(parseFontStack("Helvetica, Arial, sans-serif")).toEqual<FontStackCandidate[]>([
      { kind: "name", value: "Helvetica" },
      { kind: "name", value: "Arial" },
      { kind: "generic", value: "sans-serif" },
    ]);
  });

  it("strips surrounding double quotes from quoted names", () => {
    expect(parseFontStack(`"Helvetica Neue", sans-serif`)).toEqual<FontStackCandidate[]>([
      { kind: "name", value: "Helvetica Neue" },
      { kind: "generic", value: "sans-serif" },
    ]);
  });

  it("preserves a comma embedded inside a quoted candidate", () => {
    expect(parseFontStack(`"Arial, Bold", sans-serif`)).toEqual<FontStackCandidate[]>([
      { kind: "name", value: "Arial, Bold" },
      { kind: "generic", value: "sans-serif" },
    ]);
  });

  it("recognises `-apple-system` as a name, not a generic keyword", () => {
    expect(parseFontStack("-apple-system, sans-serif")).toEqual<FontStackCandidate[]>([
      { kind: "name", value: "-apple-system" },
      { kind: "generic", value: "sans-serif" },
    ]);
  });

  it("treats `system-ui` as a generic family", () => {
    expect(parseFontStack("system-ui")).toEqual<FontStackCandidate[]>([
      { kind: "generic", value: "system-ui" },
    ]);
  });

  it("normalises generic-family casing", () => {
    expect(parseFontStack("Sans-Serif")).toEqual<FontStackCandidate[]>([
      { kind: "generic", value: "sans-serif" },
    ]);
  });

  it("returns an empty array for an empty input", () => {
    expect(parseFontStack("")).toEqual([]);
    expect(parseFontStack("   ")).toEqual([]);
  });

  it("supports single-quoted candidates", () => {
    expect(parseFontStack(`'Helvetica Neue', sans-serif`)).toEqual<FontStackCandidate[]>([
      { kind: "name", value: "Helvetica Neue" },
      { kind: "generic", value: "sans-serif" },
    ]);
  });
});

describe("UnresolvedFontStackError", () => {
  it("includes the candidate list in the message so callers can grep the failure", () => {
    const candidates: FontStackCandidate[] = [
      { kind: "name", value: "-apple-system" },
      { kind: "generic", value: "sans-serif" },
    ];
    const err = new UnresolvedFontStackError(candidates);
    expect(err.message).toContain(`"-apple-system"`);
    expect(err.message).toContain("sans-serif");
    expect(err.candidates).toEqual(candidates);
  });
});
