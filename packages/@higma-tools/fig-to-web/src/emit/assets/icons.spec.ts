/**
 * @file Lock down the icon-asset registry contract.
 *
 * The registry is the single mediator between the JSX emitter's
 * `maybeExternalizeIcon` decision and the orchestrator's
 * `EmitResult.assets` aggregation. Three contracts pin the behaviour:
 *
 *   1. Deduplication by node guid — registering the same node twice
 *      returns the same relative path and does not duplicate the
 *      asset entry. The same icon SYMBOL referenced from two
 *      INSTANCEs must produce one `.svg` file.
 *   2. Slug uniqueness — two distinct nodes with the same Figma name
 *      ("Icon", "Icon") must produce distinct slugs so neither
 *      asset overwrites the other on disk.
 *   3. Empty / blank node name throws. The slug derives from the
 *      authored Figma layer name; missing means something upstream
 *      stripped data the contract requires, so the registry fails
 *      loudly instead of silently inventing a guid-derived stand-in
 *      that would hide the bug (fail-fast policy from AGENTS.md).
 */
import type { FigNode } from "@higma-document-models/fig/types";
import { createIconRegistry } from "./icons";

function makeNode(localID: number, name: string): FigNode {
  return {
    guid: { sessionID: 1, localID },
    phase: { value: 0, name: "CREATED" },
    type: { value: 0, name: "FRAME" },
    name,
  } as FigNode;
}

describe("createIconRegistry", () => {
  it("returns /assets/icons/<slug>.svg on first register and dedupes on guid", () => {
    const registry = createIconRegistry();
    const node = makeNode(1, "Star Icon");
    const first = registry.register(node, "<svg/>");
    const second = registry.register(node, "<svg>different</svg>");
    expect(first).toBe("/assets/icons/star-icon.svg");
    expect(second).toBe(first);
    const assets = registry.collected();
    expect(assets.length).toBe(1);
    // Dedup keeps the FIRST registration's contents — second-call
    // bytes are ignored because the slug is already claimed.
    expect(assets[0]?.contents).toBe("<svg/>");
  });

  it("disambiguates same-name nodes with a unique suffix", () => {
    const registry = createIconRegistry();
    registry.register(makeNode(1, "Icon"), "<svg>a</svg>");
    registry.register(makeNode(2, "Icon"), "<svg>b</svg>");
    const paths = registry.collected().map((a) => a.path);
    expect(paths.length).toBe(2);
    expect(paths[0]).toBe("assets/icons/icon.svg");
    expect(paths[1]).not.toBe(paths[0]);
  });

  it("throws when the node name is empty (fail-fast contract)", () => {
    const registry = createIconRegistry();
    expect(() => registry.register(makeNode(42, ""), "<svg/>")).toThrow(/layer name is empty/);
  });

  it("throws when the node name is whitespace-only", () => {
    const registry = createIconRegistry();
    expect(() => registry.register(makeNode(43, "   "), "<svg/>")).toThrow(/layer name is empty/);
  });
});
