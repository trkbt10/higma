#!/usr/bin/env bun
/**
 * @file Quick pixel sampler for diagnosing frame visual diffs.
 *
 *   bun run scripts/sample-px.ts <path-to-png> <x> <y> [<x> <y>…]
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PNG } from "pngjs";

async function sampleAt(path: string, points: ReadonlyArray<readonly [number, number]>): Promise<void> {
  const bytes = await readFile(resolve(process.cwd(), path));
  const png = PNG.sync.read(bytes);
  for (const [x, y] of points) {
    const idx = (y * png.width + x) * 4;
    const r = png.data[idx];
    const g = png.data[idx + 1];
    const b = png.data[idx + 2];
    const a = png.data[idx + 3];
    process.stdout.write(`${path} @${x},${y}: rgba=(${r}, ${g}, ${b}, ${a})\n`);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length < 3 || (argv.length - 1) % 2 !== 0) {
    process.stderr.write("usage: bun run scripts/sample-px.ts <path-to-png> <x> <y> [<x> <y>…]\n");
    process.exit(2);
  }
  const path = argv[0];
  if (!path) {
    throw new Error("missing path argument");
  }
  const points: Array<[number, number]> = [];
  for (let i = 1; i < argv.length; i += 2) {
    const xRaw = argv[i];
    const yRaw = argv[i + 1];
    if (xRaw === undefined || yRaw === undefined) {
      throw new Error("missing x or y argument");
    }
    const x = Number.parseInt(xRaw, 10);
    const y = Number.parseInt(yRaw, 10);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(`bad coordinate "${xRaw} ${yRaw}"`);
    }
    points.push([x, y]);
  }
  await sampleAt(path, points);
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  },
);
