/**
 * @file Unit tests for the darwin FontResolver.
 *
 * The catalogue loader (`loadDarwinFontCatalog`) shells out to
 * `system_profiler` and is not exercised here — that path is
 * platform-bound and would make CI flaky against the host's
 * installed-font set. Instead the resolver layer is driven by
 * `resolverFromCatalog`, which takes a deterministic catalogue the
 * spec controls. The JSON-parsing path (`parseDarwinFontDump`) IS
 * exercised because it is pure and deterministic.
 */
import {
  parseDarwinFontDump,
  resolverFromCatalog,
  type DarwinFontCatalog,
} from "./darwin";
import { UnresolvedFontStackError } from "../normalize/font-resolver";

describe("parseDarwinFontDump", () => {
  it("collects family / fullname / postscript names from every typeface", () => {
    const json = JSON.stringify({
      SPFontsDataType: [
        {
          typefaces: [
            {
              _name: "HelveticaNeue-Bold",
              family: "Helvetica Neue",
              fullname: "Helvetica Neue Bold",
            },
          ],
        },
      ],
    });
    const catalog = parseDarwinFontDump(json);
    expect(catalog.installed.has("Helvetica Neue")).toBe(true);
    expect(catalog.installed.has("Helvetica Neue Bold")).toBe(true);
    expect(catalog.installed.has("HelveticaNeue-Bold")).toBe(true);
  });

  it("ignores entries without typefaces", () => {
    const json = JSON.stringify({ SPFontsDataType: [{ valid: "yes" }] });
    const catalog = parseDarwinFontDump(json);
    expect(catalog.installed.size).toBe(0);
  });

  it("handles a missing SPFontsDataType key", () => {
    const catalog = parseDarwinFontDump(JSON.stringify({}));
    expect(catalog.installed.size).toBe(0);
  });
});

describe("resolverFromCatalog", () => {
  const installed = new Set([
    "Helvetica Neue",
    "Helvetica",
    "SF Pro",
    "Menlo",
  ]);
  const catalog: DarwinFontCatalog = { installed };
  const resolver = resolverFromCatalog(catalog);

  it("returns the first installed name in source order", () => {
    expect(
      resolver.resolve([
        { kind: "name", value: "Definitely Not Installed Font" },
        { kind: "name", value: "Helvetica Neue" },
        { kind: "generic", value: "sans-serif" },
      ]),
    ).toBe("Helvetica Neue");
  });

  it("maps `-apple-system` to the macOS System Font name (the OS-installed family WebKit dispatches to)", () => {
    expect(
      resolver.resolve([
        { kind: "name", value: "-apple-system" },
      ]),
    ).toBe("System Font");
  });

  it("maps `system-ui` to the macOS System Font name", () => {
    expect(resolver.resolve([{ kind: "generic", value: "system-ui" }])).toBe("System Font");
  });

  it("maps `monospace` to Menlo", () => {
    expect(resolver.resolve([{ kind: "generic", value: "monospace" }])).toBe("Menlo");
  });

  it("maps `BlinkMacSystemFont` to the macOS System Font name", () => {
    expect(resolver.resolve([{ kind: "name", value: "BlinkMacSystemFont" }])).toBe("System Font");
  });

  it("walks past non-installed names to find the first installed family", () => {
    expect(
      resolver.resolve([
        { kind: "name", value: "Foo" },
        { kind: "name", value: "Bar" },
        { kind: "name", value: "Helvetica" },
      ]),
    ).toBe("Helvetica");
  });

  it("falls through to the trailing generic family when no name matches", () => {
    expect(
      resolver.resolve([
        { kind: "name", value: "Foo" },
        { kind: "name", value: "Bar" },
        { kind: "generic", value: "sans-serif" },
      ]),
    ).toBe("Helvetica Neue");
  });

  it("throws when no candidate resolves and no generic fallback is supplied", () => {
    expect(() =>
      resolver.resolve([
        { kind: "name", value: "Foo" },
        { kind: "name", value: "Bar" },
      ]),
    ).toThrow(UnresolvedFontStackError);
  });

  it("preserves a real example.com stack", () => {
    // Verbatim from example.com's `getComputedStyle().fontFamily`.
    expect(
      resolver.resolve([
        { kind: "name", value: "-apple-system" },
        { kind: "generic", value: "system-ui" },
        { kind: "name", value: "BlinkMacSystemFont" },
        { kind: "name", value: "Segoe UI" },
        { kind: "name", value: "Helvetica Neue" },
        { kind: "generic", value: "sans-serif" },
      ]),
    ).toBe("System Font");
  });
});
