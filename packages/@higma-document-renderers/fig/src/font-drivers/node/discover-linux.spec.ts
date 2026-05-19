/**
 * @file Linux fontconfig discovery tests.
 *
 * Validates that the driver consults `fc-list` (the OS-canonical
 * fontconfig interface) when available, parses TTC face indices
 * out of fontconfig's bit-packed `index` field, and falls back to
 * direct directory scanning when the binary is missing.
 */

import { discoverLinux, parseFcListOutput } from "./discover-linux";
import type { DiscoveryEnv } from "./discover-types";
import { createFakeExec, createFakeFs } from "./font-driver-test-fixtures";

function makeEnv(overrides: Partial<DiscoveryEnv>): DiscoveryEnv {
  return {
    fs: createFakeFs(),
    exec: createFakeExec({}),
    homeDir: "/home/user",
    localAppData: undefined,
    windowsDir: undefined,
    xdgDataHome: undefined,
    xdgConfigHome: undefined,
    ...overrides,
  };
}

describe("parseFcListOutput", () => {
  it("parses single-face entries with no TTC index", () => {
    const stdout = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf\t0\n";

    const out = parseFcListOutput(stdout);

    expect(out).toEqual([
      { path: "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", faceIndex: 0 },
    ]);
  });

  it("extracts TTC face indices from the high bits of the index field", () => {
    // fontconfig packs the face index into bits 16..31; the second
    // face of a TTC reports index = 65536 (1 << 16). Bare `0` and
    // `1` would be the first face's instance variants.
    const stdout = [
      "/System/Library/Fonts/Helvetica.ttc\t0",
      "/System/Library/Fonts/Helvetica.ttc\t65536",
      "/System/Library/Fonts/Helvetica.ttc\t131072",
      "",
    ].join("\n");

    const out = parseFcListOutput(stdout);

    expect(out.map((f) => [f.path, f.faceIndex])).toEqual([
      ["/System/Library/Fonts/Helvetica.ttc", 0],
      ["/System/Library/Fonts/Helvetica.ttc", 1],
      ["/System/Library/Fonts/Helvetica.ttc", 2],
    ]);
  });

  it("dedupes identical (file, face) pairs that fontconfig may repeat", () => {
    // fontconfig sometimes lists the same face twice — once per
    // language / style alias — when `-f` only emits file+index. The
    // discovery layer collapses those.
    const stdout = [
      "/usr/share/fonts/Inter.ttf\t0",
      "/usr/share/fonts/Inter.ttf\t0",
      "/usr/share/fonts/Inter.ttf\t0",
      "",
    ].join("\n");

    const out = parseFcListOutput(stdout);

    expect(out).toHaveLength(1);
  });

  it("ignores blank and malformed lines", () => {
    const stdout = "\n/x.ttf\t0\nno-tab\n\n";

    const out = parseFcListOutput(stdout);

    expect(out).toEqual([{ path: "/x.ttf", faceIndex: 0 }]);
  });
});

describe("discoverLinux", () => {
  it("returns the fontconfig catalogue when fc-list succeeds", async () => {
    const env = makeEnv({
      exec: createFakeExec({
        "fc-list": async () =>
          "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf\t0\n",
      }),
    });

    const result = await discoverLinux(env);

    expect(result.source).toBe("linux-fontconfig");
    expect(result.files).toEqual([
      { path: "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", faceIndex: 0 },
    ]);
  });

  it("invokes fc-list with the documented machine-readable format flag", async () => {
    const calls: Array<{ readonly cmd: string; readonly args: readonly string[] }> = [];
    const env = makeEnv({
      exec: {
        async run(cmd, args) {
          calls.push({ cmd, args });
          return "";
        },
      },
    });

    await discoverLinux(env);

    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toBe("fc-list");
    expect(calls[0].args[0]).toBe("-f");
    // The format string is an internal contract, but the file/index
    // pair must always be present — anything else makes the parser
    // drop entries.
    expect(calls[0].args[1]).toContain("%{file}");
    expect(calls[0].args[1]).toContain("%{index}");
  });

  it("falls back to direct directory scanning when fc-list is unavailable", async () => {
    const fs = createFakeFs();
    fs.putFile("/usr/share/fonts/Foo.ttf", new Uint8Array([0]));
    fs.putFile("/home/user/.local/share/fonts/Bar.otf", new Uint8Array([0]));
    const env = makeEnv({
      fs,
      exec: createFakeExec({
        "fc-list": async () => {
          throw new Error("fc-list: command not found");
        },
      }),
    });

    const result = await discoverLinux(env);

    expect(result.source).toBe("linux-dirs");
    expect(new Set(result.files.map((f) => f.path))).toEqual(
      new Set(["/usr/share/fonts/Foo.ttf", "/home/user/.local/share/fonts/Bar.otf"]),
    );
  });

  it("includes XDG_DATA_HOME font dir on the directory-scan fallback path", async () => {
    const fs = createFakeFs();
    fs.putFile("/xdg/data/fonts/Custom.ttf", new Uint8Array([0]));
    const env = makeEnv({
      fs,
      exec: createFakeExec({
        "fc-list": async () => {
          throw new Error("ENOENT");
        },
      }),
      xdgDataHome: "/xdg/data",
    });

    const result = await discoverLinux(env);

    expect(result.source).toBe("linux-dirs");
    expect(result.files.map((f) => f.path)).toContain("/xdg/data/fonts/Custom.ttf");
  });
});
