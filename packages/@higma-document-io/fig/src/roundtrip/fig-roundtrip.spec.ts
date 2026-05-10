/**
 * @file Roundtrip integrity test against a real Figma export.
 *
 * Real Figma exports carry visual-style enum members the runtime
 * tables historically didn't know about (GLASS effects, the schema-
 * canonical ImageScaleMode value mapping, etc.). This spec loads
 * a real fixture, re-saves it through `saveFigFile`, and confirms
 * the round-tripped payload still reports the same enum names — a
 * regression here would mean a schema-derived table dropped a
 * member silently or a denormalisation step lost data.
 */

import fs from "node:fs";
import path from "node:path";
import { loadFigFile, saveFigFile } from "./fig-roundtrip";
import { parseFigFile } from "../parser";

const FIXTURE_PATH = path.resolve(__dirname, "../../../../@higma-document-renderers/fig/fixtures/inherit/inherit.fig");

type AnyNode = Record<string, unknown>;

function readEnumName(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && "name" in value) {
    return String((value as { name: unknown }).name);
  }
  return "<unknown>";
}

function tallyEffects(nodes: readonly AnyNode[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    const effects = node.effects;
    if (!Array.isArray(effects)) {
      continue;
    }
    for (const effect of effects as AnyNode[]) {
      const name = readEnumName(effect.type);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return Object.fromEntries(counts);
}

function tallyImageScaleModes(nodes: readonly AnyNode[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    for (const fieldName of ["fillPaints", "strokePaints", "backgroundPaints"] as const) {
      const list = node[fieldName];
      if (!Array.isArray(list)) {
        continue;
      }
      for (const paint of list as AnyNode[]) {
        if (paint.type !== "IMAGE") {
          continue;
        }
        const name = readEnumName(paint.scaleMode ?? paint.imageScaleMode);
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
  }
  return Object.fromEntries(counts);
}

describe("loadFigFile → saveFigFile (real Figma export)", () => {
  // Skip silently when the fixture is not on disk (the fig-renderers
  // package controls the file; this spec must not fail when the
  // package boundary changes).
  const hasFixture = fs.existsSync(FIXTURE_PATH);

  it.skipIf(!hasFixture)("preserves visual-style enum members through one round trip", async () => {
    const original = new Uint8Array(fs.readFileSync(FIXTURE_PATH));
    const loaded = await loadFigFile(original);
    const resaved = await saveFigFile(loaded);

    const before = await parseFigFile(original);
    const after = await parseFigFile(resaved);

    const beforeEffects = tallyEffects(before.nodeChanges as readonly AnyNode[]);
    const afterEffects = tallyEffects(after.nodeChanges as readonly AnyNode[]);
    expect(afterEffects).toEqual(beforeEffects);

    // Sanity: the fixture has at least one of the schema-extended
    // effect types we previously dropped. If this assertion ever
    // becomes wrong (Figma re-exports the fixture without GLASS),
    // adjust to whatever rare member remains.
    expect(beforeEffects.GLASS).toBeGreaterThan(0);

    const beforeScaleModes = tallyImageScaleModes(before.nodeChanges as readonly AnyNode[]);
    const afterScaleModes = tallyImageScaleModes(after.nodeChanges as readonly AnyNode[]);
    expect(afterScaleModes).toEqual(beforeScaleModes);
  });
});
