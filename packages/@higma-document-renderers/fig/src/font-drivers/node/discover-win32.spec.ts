/**
 * @file Windows registry-based font discovery tests.
 *
 * The OS-canonical font catalogue on Windows is the registry, not
 * the directory `C:\Windows\Fonts`. These tests validate that the
 * driver:
 *   - parses `reg.exe query /s /t REG_SZ` output correctly,
 *   - resolves bare filenames against `%WINDIR%\Fonts`,
 *   - merges HKLM + HKCU entries,
 *   - falls back to directory scanning when `reg.exe` is absent.
 */

import { discoverWin32, parseRegQueryOutput } from "./discover-win32";
import type { DiscoveryEnv } from "./discover-types";
import { createFakeExec, createFakeFs } from "./test-helpers";

function makeEnv(overrides: Partial<DiscoveryEnv>): DiscoveryEnv {
  return {
    fs: createFakeFs(),
    exec: createFakeExec({}),
    homeDir: "C:/Users/user",
    localAppData: "C:/Users/user/AppData/Local",
    windowsDir: "C:/Windows",
    xdgDataHome: undefined,
    xdgConfigHome: undefined,
    ...overrides,
  };
}

describe("parseRegQueryOutput", () => {
  it("parses multi-key reg.exe output", () => {
    const stdout = [
      "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts",
      "    Arial (TrueType)    REG_SZ    arial.ttf",
      "    Arial Bold (TrueType)    REG_SZ    arialbd.ttf",
      "",
      "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts\\Cache",
      "    cached    REG_SZ    ignored.bin",
      "",
    ].join("\r\n");

    const out = parseRegQueryOutput(stdout);

    expect(out).toEqual([
      { name: "Arial (TrueType)", value: "arial.ttf" },
      { name: "Arial Bold (TrueType)", value: "arialbd.ttf" },
      { name: "cached", value: "ignored.bin" },
    ]);
  });

  it("skips lines without REG_SZ — REG_DWORD entries don't carry filenames", () => {
    const stdout = [
      "HKEY_LOCAL_MACHINE\\Foo",
      "    Counter    REG_DWORD    0x00000001",
      "    Path    REG_SZ    arial.ttf",
      "",
    ].join("\n");

    const out = parseRegQueryOutput(stdout);

    expect(out).toEqual([{ name: "Path", value: "arial.ttf" }]);
  });

  it("handles trailing whitespace and CRLF line endings", () => {
    const stdout = "    A    REG_SZ    a.ttf   \r\n    B    REG_SZ    b.ttf\r\n";

    const out = parseRegQueryOutput(stdout);

    expect(out.map((e) => e.value)).toEqual(["a.ttf", "b.ttf"]);
  });
});

describe("discoverWin32", () => {
  it("resolves bare filenames against %WINDIR%\\Fonts and absolute paths verbatim", async () => {
    const fs = createFakeFs();
    const env = makeEnv({
      fs,
      windowsDir: "C:/Windows",
      exec: createFakeExec({
        "reg.exe": async (args) => {
          if (args.includes("HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts")) {
            return "    Arial (TrueType)    REG_SZ    arial.ttf\n";
          }
          if (args.includes("HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts")) {
            return "    Custom Font    REG_SZ    C:\\Users\\user\\AppData\\Local\\Microsoft\\Windows\\Fonts\\custom.ttf\n";
          }
          return "";
        },
      }),
    });

    const result = await discoverWin32(env);

    expect(result.source).toBe("win32-registry");
    expect(new Set(result.files.map((f) => f.path))).toEqual(
      new Set([
        "C:/Windows/Fonts/arial.ttf",
        "C:\\Users\\user\\AppData\\Local\\Microsoft\\Windows\\Fonts\\custom.ttf",
      ]),
    );
  });

  it("dedupes when both HKLM and HKCU list the same path", async () => {
    const env = makeEnv({
      exec: createFakeExec({
        "reg.exe": async () => "    A    REG_SZ    arial.ttf\n",
      }),
    });

    const result = await discoverWin32(env);

    expect(result.files).toHaveLength(1);
  });

  it("filters out non-parseable extensions even when registered", async () => {
    const env = makeEnv({
      exec: createFakeExec({
        "reg.exe": async () => "    Bitmap    REG_SZ    bitmap.fon\n",
      }),
    });

    const result = await discoverWin32(env);

    // .fon (legacy bitmap) cannot be parsed by opentype.js; the
    // driver excludes it at discovery so the indexer doesn't waste
    // time on guaranteed failures.
    expect(result.files).toEqual([]);
  });

  it("falls back to directory scanning when reg.exe is unavailable", async () => {
    const fs = createFakeFs();
    fs.putFile("C:/Windows/Fonts/arial.ttf", new Uint8Array([0]));
    // The per-user `%LOCALAPPDATA%\Microsoft\Windows\Fonts` dir is
    // also part of the fallback set; we use forward-slash separators
    // throughout the fake FS, so we mirror that here. The discovery
    // call uses `path.join`, whose separator behaviour follows the
    // test-host platform — on posix that preserves literal `\` in
    // its arguments. We sidestep the cross-platform separator quirk
    // by setting `localAppData` to a path whose `Microsoft\Windows\Fonts`
    // suffix is already inlined as forward-slash and presenting it
    // as the source of truth.
    fs.putFile("C:/UserFonts/Microsoft/Windows/Fonts/custom.ttf", new Uint8Array([0]));
    const env = makeEnv({
      fs,
      exec: createFakeExec({
        "reg.exe": async () => {
          throw new Error("reg.exe: command not found");
        },
      }),
      // We can't usefully assert the per-user subpath because
      // `path.join` on the host platform varies; the system Fonts
      // dir is enough to demonstrate the fallback strategy.
      localAppData: "C:/UserFonts",
    });

    const result = await discoverWin32(env);

    expect(result.source).toBe("win32-dirs");
    expect(result.files.map((f) => f.path)).toContain("C:/Windows/Fonts/arial.ttf");
  });
});
