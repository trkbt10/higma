/**
 * @file Verify `Decisions.typography[*].merge` redirects bind actions
 * away from the alias and onto the primary's resolved styleDefinition.
 *
 * The alias entry is fabricated by hand on top of the inventory built
 * from a real fixture: this keeps the inventory shape identical to
 * what the analyser actually produces, while letting the spec exercise
 * a merge case the fixture itself may not expose. The plan layer is
 * the single source of truth for merge resolution (apply only consumes
 * the bind actions), so we assert on the plan.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadRefineSource } from "../src/refine-source/load";
import { buildInventory } from "../src/inventory";
import type { Inventory, TypographyEntry } from "../src/inventory";
import type { Decisions } from "../src/decisions";
import { buildPlan } from "../src/plan";
import type { ActionBindTextStyle, ActionCreateTextStyleDefinition } from "../src/plan";

const FIXTURES_ROOT = resolve(__dirname, "../../../@higma-document-renderers/fig/fixtures");
const FIXTURE = "text-styling/text-styling.fig";

function makeAlias(primary: TypographyEntry, key: string, lhValue: number, usageNodeGuid: string): TypographyEntry {
  return {
    key,
    descriptor: {
      fontFamily: primary.descriptor.fontFamily,
      fontStyle: primary.descriptor.fontStyle,
      fontWeight: primary.descriptor.fontWeight,
      fontSize: primary.descriptor.fontSize,
      lineHeightKey: `${lhValue.toFixed(3)}PIXELS`,
      letterSpacingKey: primary.descriptor.letterSpacingKey,
    },
    usages: [
      {
        nodeGuid: usageNodeGuid,
        nodeName: "alias-stray",
        characters: "x",
        characterCount: 1,
      },
    ],
    aliases: [],
    existingStyleDefinitionGuid: undefined,
    existingStyleDefinitionName: undefined,
  };
}

describe("refine-fig typography merge — plan layer", () => {
  it("binds the alias's usages to the primary's just-created styleDefinition", async () => {
    const buf = await readFile(resolve(FIXTURES_ROOT, FIXTURE));
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const source = await loadRefineSource(bytes);
    const baseInventory = await buildInventory(source, { figPath: FIXTURE, skipClusters: true });
    if (baseInventory.typography.length === 0) {
      throw new Error(`${FIXTURE} fixture has no TEXT nodes — choose a different fixture for this spec`);
    }

    const primary = baseInventory.typography[0];
    if (!primary) {
      throw new Error("expected at least one typography entry");
    }
    const alias = makeAlias(primary, "ALIAS_KEY", 99, "1:99");
    const inventory: Inventory = {
      palette: baseInventory.palette,
      typography: [...baseInventory.typography, alias],
      structureClusters: [],
      geometryClusters: [],
      unrenderable: [],
      layoutHints: [],
    };
    const decisions: Decisions = {
      clusters: {},
      palette: Object.fromEntries(baseInventory.palette.map((p) => [p.key, { name: "" }])),
      typography: {
        ...Object.fromEntries(baseInventory.typography.map((t) => [t.key, { name: t === primary ? "body" : "" }])),
        ALIAS_KEY: { name: "", merge: primary.key },
      },
    };

    const plan = buildPlan(source, inventory, decisions, { file: FIXTURE, bytes: bytes.byteLength });

    // The primary has no existing styleDefinition in the fixture (it's an untouched
    // rectangle fixture), so a create-text-style-definition lands first and the
    // bind actions reference its token.
    const creates = plan.actions.filter((a) => a.kind === "create-text-style-definition") as readonly ActionCreateTextStyleDefinition[];
    expect(creates.length, "expected exactly one create-text-style-definition for the primary").toBe(1);
    const token = creates[0]?.token;
    if (!token) {
      throw new Error("expected a token");
    }

    const binds = plan.actions.filter((a) => a.kind === "bind-text-style") as readonly ActionBindTextStyle[];
    expect(binds.length, "expected primary usage(s) + alias usage all bound").toBeGreaterThan(0);
    const aliasBind = binds.find((b) => b.nodeGuid === "1:99");
    if (!aliasBind) {
      throw new Error("alias usage must be bound");
    }
    expect(aliasBind.styleDefinition).toEqual({ kind: "token", token });
  });

  it("throws when merge target is unknown", async () => {
    const buf = await readFile(resolve(FIXTURES_ROOT, FIXTURE));
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const source = await loadRefineSource(bytes);
    const inventory = await buildInventory(source, { figPath: FIXTURE, skipClusters: true });
    const alias = makeAlias(inventory.typography[0]!, "ALIAS_KEY", 99, "1:99");
    const augmented: Inventory = {
      palette: inventory.palette,
      typography: [...inventory.typography, alias],
      structureClusters: [],
      geometryClusters: [],
      unrenderable: [],
      layoutHints: [],
    };
    const decisions: Decisions = {
      clusters: {},
      palette: Object.fromEntries(augmented.palette.map((p) => [p.key, { name: "" }])),
      typography: {
        ...Object.fromEntries(inventory.typography.map((t) => [t.key, { name: "" }])),
        ALIAS_KEY: { name: "", merge: "DOES_NOT_EXIST" },
      },
    };

    expect(() => buildPlan(source, augmented, decisions, { file: FIXTURE, bytes: bytes.byteLength })).toThrow(
      /not an inventory entry/i,
    );
  });

  it("throws when merge target is itself merged (no chains)", async () => {
    const buf = await readFile(resolve(FIXTURES_ROOT, FIXTURE));
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const source = await loadRefineSource(bytes);
    const inventory = await buildInventory(source, { figPath: FIXTURE, skipClusters: true });
    const primary = inventory.typography[0]!;
    const aliasA = makeAlias(primary, "ALIAS_A", 99, "1:99");
    const aliasB = makeAlias(primary, "ALIAS_B", 100, "1:100");
    const augmented: Inventory = {
      palette: inventory.palette,
      typography: [...inventory.typography, aliasA, aliasB],
      structureClusters: [],
      geometryClusters: [],
      unrenderable: [],
      layoutHints: [],
    };
    const decisions: Decisions = {
      clusters: {},
      palette: Object.fromEntries(augmented.palette.map((p) => [p.key, { name: "" }])),
      typography: {
        ...Object.fromEntries(inventory.typography.map((t) => [t.key, { name: t === primary ? "body" : "" }])),
        ALIAS_A: { name: "", merge: primary.key },
        ALIAS_B: { name: "", merge: "ALIAS_A" },
      },
    };

    expect(() => buildPlan(source, augmented, decisions, { file: FIXTURE, bytes: bytes.byteLength })).toThrow(
      /chains are not allowed/i,
    );
  });

  it("throws when merge target has no resolved styleDefinition", async () => {
    const buf = await readFile(resolve(FIXTURES_ROOT, FIXTURE));
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const source = await loadRefineSource(bytes);
    const inventory = await buildInventory(source, { figPath: FIXTURE, skipClusters: true });
    const primary = inventory.typography[0]!;
    const alias = makeAlias(primary, "ALIAS_KEY", 99, "1:99");
    const augmented: Inventory = {
      palette: inventory.palette,
      typography: [...inventory.typography, alias],
      structureClusters: [],
      geometryClusters: [],
      unrenderable: [],
      layoutHints: [],
    };
    const decisions: Decisions = {
      clusters: {},
      palette: Object.fromEntries(augmented.palette.map((p) => [p.key, { name: "" }])),
      typography: {
        ...Object.fromEntries(inventory.typography.map((t) => [t.key, { name: "" }])),
        ALIAS_KEY: { name: "", merge: primary.key },
      },
    };

    expect(() => buildPlan(source, augmented, decisions, { file: FIXTURE, bytes: bytes.byteLength })).toThrow(
      /no resolved styleDefinition/i,
    );
  });
});
