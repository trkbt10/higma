#!/usr/bin/env bun
/**
 * @file Copy every per-frame `reference.png` shipped by
 * `@higma-tools/fig-to-swiftui/cases/<case>/<frame>/reference.png` into
 * the matching `@higma-tools/fig-to-godot/cases/<case>/<frame>/`. The
 * cross-tool boundary forbids a runtime import; the bytes get copied.
 *
 * Run via:
 *   bun run packages/@higma-tools/fig-to-godot/scripts/sync-references.ts
 */
import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..", "..");
const SWIFTUI_CASES = resolve(REPO_ROOT, "packages/@higma-tools/fig-to-swiftui/cases");
const GODOT_CASES = resolve(REPO_ROOT, "packages/@higma-tools/fig-to-godot/cases");

let copied = 0;
let skipped = 0;
for (const caseName of readdirSync(SWIFTUI_CASES)) {
  const srcCaseDir = resolve(SWIFTUI_CASES, caseName);
  if (!statSync(srcCaseDir).isDirectory()) {
    continue;
  }
  for (const frameName of readdirSync(srcCaseDir)) {
    const srcFrameDir = resolve(srcCaseDir, frameName);
    if (!statSync(srcFrameDir).isDirectory()) {
      continue;
    }
    const srcRef = resolve(srcFrameDir, "reference.png");
    if (!existsSync(srcRef)) {
      skipped += 1;
      continue;
    }
    const dstFrameDir = resolve(GODOT_CASES, caseName, frameName);
    mkdirSync(dstFrameDir, { recursive: true });
    const dstRef = resolve(dstFrameDir, "reference.png");
    copyFileSync(srcRef, dstRef);
    copied += 1;
  }
}
process.stdout.write(`Copied ${copied} reference PNGs (skipped ${skipped} dirs without references).\n`);
