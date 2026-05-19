/**
 * @file Node font driver test fixtures.
 *
 * Two pieces:
 *   - `createFakeFs` — an in-memory filesystem implementing the
 *     `DiscoveryFs` shape so per-platform discovery can be exercised
 *     deterministically without touching the host.
 *   - `synthesizeFontBytes` — produces a tiny but parseable TTF
 *     buffer with a chosen family / subfamily, used to build the
 *     fixture catalogue for end-to-end loader tests.
 *
 * This module is `*.ts` rather than `*.spec.ts` so other co-located
 * specs can import it. It MUST stay test-only — the production loader
 * never imports it, and `vitest --run` with the package's `src` glob
 * still picks up the `*.spec.ts` siblings.
 */

import { Font, Glyph, Path } from "opentype.js";
import type { Dirent } from "node:fs";
import type { DiscoveryExec, DiscoveryFs } from "./discover-types";

export type FakeFsEntry =
  | { readonly kind: "file"; readonly bytes: Uint8Array }
  | { readonly kind: "dir" }
  | { readonly kind: "symlink"; readonly target: string };

export type FakeFs = DiscoveryFs & {
  /** Add a file at `path`. Parent directories are created as needed. */
  putFile(path: string, bytes: Uint8Array): void;
  /** Add an empty directory; intermediate ancestors are created too. */
  putDir(path: string): void;
  /** Add a symlink — discovery skips these unconditionally. */
  putSymlink(path: string, target: string): void;
};

/**
 * Build an in-memory FS that implements just the four `node:fs`
 * synchronous calls the discovery layer uses. Path semantics are
 * platform-style: `/` separator throughout. Tests targeting
 * Windows discovery should use forward-slash paths in the fake;
 * the real driver uses `path.join` which honours the host
 * separator, but the seam is internally consistent because we test
 * the path join routines separately and pass the fake's pre-joined paths.
 */
export function createFakeFs(): FakeFs {
  const entries = new Map<string, FakeFsEntry>();
  entries.set("/", { kind: "dir" });

  function ensureAncestors(path: string): void {
    const parts = splitPath(path);
    for (let i = 1; i < parts.length; i += 1) {
      const ancestor = parts.slice(0, i).join("/") || "/";
      if (!entries.has(ancestor)) {
        entries.set(ancestor, { kind: "dir" });
      }
    }
  }

  function putFile(path: string, bytes: Uint8Array): void {
    ensureAncestors(path);
    entries.set(path, { kind: "file", bytes });
  }

  function putDir(path: string): void {
    ensureAncestors(path);
    entries.set(path, { kind: "dir" });
  }

  function putSymlink(path: string, target: string): void {
    ensureAncestors(path);
    entries.set(path, { kind: "symlink", target });
  }

  function existsSync(path: string): boolean {
    return entries.has(path);
  }

  function readdirSync(path: string, opts?: { withFileTypes?: boolean }): readonly Dirent[] | readonly string[] {
    if (!entries.has(path)) {
      const err = new Error(`ENOENT: no such directory, scandir '${path}'`) as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    }
    const prefix = path.endsWith("/") ? path : `${path}/`;
    const children = new Map<string, FakeFsEntry>();
    for (const key of entries.keys()) {
      if (!key.startsWith(prefix) || key === path) {
        continue;
      }
      const rest = key.slice(prefix.length);
      const slash = rest.indexOf("/");
      const name = slash === -1 ? rest : rest.slice(0, slash);
      if (!children.has(name)) {
        const childPath = `${prefix}${name}`;
        const childEntry = entries.get(childPath);
        if (childEntry) {
          children.set(name, childEntry);
        }
      }
    }
    if (!opts?.withFileTypes) {
      return [...children.keys()].sort();
    }
    const out: Dirent[] = [];
    for (const [name, entry] of [...children.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      out.push(makeDirent(name, entry));
    }
    return out;
  }

  function readFileSync(path: string): Buffer {
    const entry = entries.get(path);
    if (!entry || entry.kind !== "file") {
      const err = new Error(`ENOENT: no such file, open '${path}'`) as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    }
    return Buffer.from(entry.bytes);
  }

  function lstatSync(path: string): { isSymbolicLink(): boolean; isDirectory(): boolean; isFile(): boolean } {
    const entry = entries.get(path);
    if (!entry) {
      const err = new Error(`ENOENT: no such file or directory, lstat '${path}'`) as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    }
    return {
      isSymbolicLink: () => entry.kind === "symlink",
      isDirectory: () => entry.kind === "dir",
      isFile: () => entry.kind === "file",
    };
  }

  return {
    putFile,
    putDir,
    putSymlink,
    existsSync: existsSync as DiscoveryFs["existsSync"],
    readdirSync: readdirSync as DiscoveryFs["readdirSync"],
    readFileSync: readFileSync as DiscoveryFs["readFileSync"],
    lstatSync: lstatSync as DiscoveryFs["lstatSync"],
  };
}

function splitPath(p: string): readonly string[] {
  if (p.startsWith("/")) {
    return ["", ...p.slice(1).split("/")];
  }
  return p.split("/");
}

function makeDirent(name: string, entry: FakeFsEntry): Dirent {
  // The `Dirent` runtime type is a class — direct property
  // construction would fail an `instanceof` check we don't expose,
  // but its structural surface is what the discovery layer reads.
  // We assemble the structural fields explicitly and use the
  // `isDirentShape` type guard to confirm the structural surface
  // before handing the value back to the typed `DiscoveryFs`
  // contract.
  const shape: DirentShape = {
    name,
    parentPath: "",
    path: "",
    isFile: () => entry.kind === "file",
    isDirectory: () => entry.kind === "dir",
    isSymbolicLink: () => entry.kind === "symlink",
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
  };
  if (!isDirentShape(shape)) {
    throw new Error("makeDirent: produced malformed shape");
  }
  return shape;
}

type DirentShape = {
  readonly name: string;
  readonly parentPath: string;
  readonly path: string;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  isBlockDevice(): boolean;
  isCharacterDevice(): boolean;
  isFIFO(): boolean;
  isSocket(): boolean;
};

/**
 * Verify the structural surface of our shim matches `Dirent` and
 * narrow the type. The runtime check exercises each method
 * `DiscoveryFs.readdirSync` consumers consult; if any is missing
 * the guard returns `false` and the caller throws.
 */
function isDirentShape(value: DirentShape): value is DirentShape & Dirent {
  return (
    typeof value.name === "string" &&
    typeof value.isFile === "function" &&
    typeof value.isDirectory === "function" &&
    typeof value.isSymbolicLink === "function" &&
    typeof value.isBlockDevice === "function" &&
    typeof value.isCharacterDevice === "function" &&
    typeof value.isFIFO === "function" &&
    typeof value.isSocket === "function"
  );
}

export type SynthesizeFontOptions = {
  readonly familyName: string;
  readonly styleName: string;
  readonly unitsPerEm?: number;
  readonly ascender?: number;
  readonly descender?: number;
};

/**
 * Build a tiny but parseable TTF buffer with a chosen family /
 * subfamily. Used as fixture data for end-to-end loader tests so we
 * don't have to commit binary font files. The font carries .notdef,
 * space, and 'A' glyphs — enough for `loadFont` to surface a real
 * `LoadedFont.font` instance with non-empty path data.
 */
export function synthesizeFontBytes(options: SynthesizeFontOptions): Uint8Array {
  const unitsPerEm = options.unitsPerEm ?? 1000;
  const ascender = options.ascender ?? 800;
  const descender = options.descender ?? -200;
  const notdef = new Glyph({ name: ".notdef", unicode: 0, advanceWidth: 650, path: new Path() });
  const space = new Glyph({ name: "space", unicode: 32, advanceWidth: 250, path: new Path() });
  const aPath = new Path();
  aPath.moveTo(0, 0);
  aPath.lineTo(300, 0);
  aPath.lineTo(150, 600);
  aPath.close();
  const a = new Glyph({ name: "A", unicode: 65, advanceWidth: 600, path: aPath });
  const font = new Font({
    familyName: options.familyName,
    styleName: options.styleName,
    unitsPerEm,
    ascender,
    descender,
    glyphs: [notdef, space, a],
  });
  return new Uint8Array(font.toArrayBuffer());
}

/**
 * Build a `DiscoveryExec` whose `run` returns canned outputs by
 * `(cmd, args[0])` — covers `fc-list`, `reg.exe query …`, etc. Any
 * unmatched invocation rejects with an error so tests notice
 * unexpected exec calls.
 */
export function createFakeExec(handlers: Record<string, (args: readonly string[]) => Promise<string>>): DiscoveryExec {
  return {
    async run(cmd: string, args: readonly string[]): Promise<string> {
      const handler = handlers[cmd];
      if (!handler) {
        throw new Error(`fakeExec: no handler for ${cmd}`);
      }
      return handler(args);
    },
  };
}
