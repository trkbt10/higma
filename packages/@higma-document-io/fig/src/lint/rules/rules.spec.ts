/**
 * @file Per-rule unit tests for fig-lint.
 *
 * Each rule is exercised in isolation against a synthetic
 * `LintContext`. The routines below build minimal contexts that
 * trip exactly one rule at a time so the assertions document
 * intent: "this is the precise condition under which rule X
 * fires, and this is everything it does in response."
 *
 * The rules produce findings against shared invariants
 * (Figma's importer requirements, schema-coverage thresholds,
 * stroke-field presence, fill-geometry coverage). Drift in any
 * of those invariants surfaces here before it ever reaches
 * `runFigHealthCheck`.
 */

import { canvasHeaderRule } from "./canvas-header";
import { displayFieldsRule } from "./display-fields";
import { imageRefsRule } from "./image-refs";
import { parentRefsRule } from "./parent-refs";
import { requiredNodesRule } from "./required-nodes";
import { schemaCoverageRule } from "./schema-coverage";
import { shapeFieldsRule } from "./shape-fields";
import { symbolInstanceRule } from "./symbol-instance";
import { visibleBlobsRule } from "./visible-blobs";
import { zipPackageRule } from "./zip-package";
import { PNG_SIGNATURE } from "@higma-codecs/png";
import { FIG_THUMBNAIL_ZIP_ENTRY } from "@higma-figma-containers/package";
import { FIGMA_KIWI_SCHEMA, type FigSchema } from "@higma-figma-schema/profiles/schema";
import { PAINT_TYPE_VALUES, STROKE_ALIGN_VALUES, STROKE_JOIN_VALUES } from "@higma-document-models/fig/constants";
import type { LintContext, LintFinding, LintRule, LintRuleId } from "../types";
import type { FigNode } from "@higma-document-models/fig/types";
import type { FigPackageImage } from "@higma-figma-containers/package";

type ContextOverrides = Partial<LintContext>;

function emptyContext(overrides: ContextOverrides = {}): LintContext {
  const base: LintContext = {
    bytes: new Uint8Array(),
    isZip: true,
    zipEntries: new Map(),
    canvasData: null,
    canvasHeader: null,
    schema: null,
    message: null,
    nodeChanges: [],
    images: new Map(),
    metadata: null,
    hasThumbnail: true,
  };
  return { ...base, ...overrides };
}

function runRule(rule: LintRule, ctx: LintContext): readonly LintFinding[] {
  const findings: LintFinding[] = [];
  rule(ctx, (finding) => findings.push(finding));
  return findings;
}

function ruleIdsOf(findings: readonly LintFinding[]): readonly LintRuleId[] {
  return findings.map((f) => f.ruleId);
}

function makeNode(overrides: Partial<FigNode>): FigNode {
  // The lint rules read FigNode shape loosely — only the fields
  // we explicitly set need to be type-correct. We therefore lean
  // on `as FigNode` to keep these test fixtures focused.
  const base = {
    guid: { sessionID: 0, localID: 0 },
    phase: { value: 0, name: "CREATED" },
    type: { value: 4, name: "FRAME" },
    name: "node",
  };
  return { ...base, ...overrides } as FigNode;
}

describe("zipPackageRule", () => {
  it("warns when input is not a zip", () => {
    const findings = runRule(zipPackageRule, emptyContext({ isZip: false, hasThumbnail: false }));
    expect(ruleIdsOf(findings)).toContain("fig.zip.header");
    expect(findings[0].severity).toBe("warning");
  });

  it("fires fig.zip.thumbnail when thumbnail.png is missing", () => {
    const findings = runRule(zipPackageRule, emptyContext({
      isZip: true,
      canvasData: new Uint8Array([1]),
      zipEntries: new Map([
        ["canvas.fig", new Uint8Array([1])],
        ["meta.json", new TextEncoder().encode("{}")],
      ]),
    }));
    expect(ruleIdsOf(findings)).toContain("fig.zip.thumbnail");
  });

  it("fires fig.zip.thumbnail when thumbnail.png lacks PNG magic", () => {
    const garbage = new Uint8Array([1, 2, 3, 4]);
    const findings = runRule(zipPackageRule, emptyContext({
      canvasData: new Uint8Array([1]),
      zipEntries: new Map([
        ["canvas.fig", new Uint8Array([1])],
        ["meta.json", new TextEncoder().encode("{}")],
        [FIG_THUMBNAIL_ZIP_ENTRY, garbage],
      ]),
    }));
    const thumbFinding = findings.find((f) => f.ruleId === "fig.zip.thumbnail");
    expect(thumbFinding?.severity).toBe("error");
    expect(thumbFinding?.message).toMatch(/PNG magic/);
  });

  it("fires fig.zip.canvas-entry when canvas.fig is missing", () => {
    const findings = runRule(zipPackageRule, emptyContext({
      canvasData: null,
      zipEntries: new Map([["meta.json", new TextEncoder().encode("{}")]]),
    }));
    expect(ruleIdsOf(findings)).toContain("fig.zip.canvas-entry");
  });

  it("passes silently for a complete zip package", () => {
    // The lint rule only validates that `thumbnail.png` starts with the
    // PNG magic — so seed the entry with exactly that prefix from the
    // codec SoT, not a hand-coded copy.
    const png = new Uint8Array(PNG_SIGNATURE);
    const findings = runRule(zipPackageRule, emptyContext({
      canvasData: new Uint8Array([1]),
      zipEntries: new Map([
        ["canvas.fig", new Uint8Array([1])],
        ["meta.json", new TextEncoder().encode("{}")],
        [FIG_THUMBNAIL_ZIP_ENTRY, png],
      ]),
    }));
    expect(findings).toEqual([]);
  });
});

describe("canvasHeaderRule", () => {
  it("does nothing when canvasHeader is absent", () => {
    expect(runRule(canvasHeaderRule, emptyContext({ canvasHeader: null }))).toEqual([]);
  });

  it("warns when header version is the legacy `0`", () => {
    const findings = runRule(canvasHeaderRule, emptyContext({
      canvasData: new Uint8Array(2300),
      canvasHeader: { magic: "fig-kiwi", version: "0", payloadSize: 1024 },
    }));
    const versionFinding = findings.find((f) => f.ruleId === "fig.canvas.version");
    expect(versionFinding?.severity).toBe("warning");
  });

  it("does not warn for the modern `e` version", () => {
    const findings = runRule(canvasHeaderRule, emptyContext({
      canvasData: new Uint8Array(2300),
      canvasHeader: { magic: "fig-kiwi", version: "e", payloadSize: 1024 },
    }));
    expect(findings).toEqual([]);
  });

  it("flags fig.canvas.payload-size when the payload is shorter than declared", () => {
    // canvasData is only 16 + 4 bytes (=20), but header claims a
    // payloadSize of 1024 — clearly truncated.
    const findings = runRule(canvasHeaderRule, emptyContext({
      canvasData: new Uint8Array(20),
      canvasHeader: { magic: "fig-kiwi", version: "e", payloadSize: 1024 },
    }));
    const payload = findings.find((f) => f.ruleId === "fig.canvas.payload-size");
    expect(payload?.severity).toBe("error");
  });
});

describe("schemaCoverageRule", () => {
  it("emits no findings when schema covers every reference definition", () => {
    // The bundled reference schema is itself the SoT — passing it
    // back as the file's schema means every definition is present.
    expect(runRule(schemaCoverageRule, emptyContext({
      schema: FIGMA_KIWI_SCHEMA as NonNullable<LintContext["schema"]>,
    }))).toEqual([]);
  });

  it("flags missing required types", () => {
    // Only one definition — every required type is missing.
    const findings = runRule(schemaCoverageRule, emptyContext({
      schema: { definitions: [{ name: "MessageType", kind: "ENUM", fields: [] }] },
    }));
    expect(ruleIdsOf(findings)).toContain("fig.schema.required-types");
    expect(ruleIdsOf(findings)).toContain("fig.schema.coverage");
  });

  it("downgrades coverage to warning when only the long tail is missing", () => {
    // Same as the bundled schema, minus a few non-hard-required
    // definitions. We can simulate this by sliding off a couple of
    // optional names.
    const reference: FigSchema = FIGMA_KIWI_SCHEMA;
    const optionalNames = new Set(["AnimationPresets", "AgendaItemType", "AccessControl"]);
    const trimmedDefinitions = reference.definitions.filter((d) => !optionalNames.has(d.name));
    const findings = runRule(schemaCoverageRule, emptyContext({
      schema: { definitions: trimmedDefinitions },
    }));
    const coverage = findings.find((f) => f.ruleId === "fig.schema.coverage");
    expect(coverage?.severity).toBe("warning");
    // Hard-required types are still present, so no error.
    expect(findings.find((f) => f.ruleId === "fig.schema.required-types")).toBeUndefined();
  });
});

describe("requiredNodesRule", () => {
  function asInternalCanvas(node: Partial<FigNode>): FigNode {
    return makeNode({ type: { value: 2, name: "CANVAS" }, name: "Internal Only Canvas", ...node, ...({ internalOnly: true } as Partial<FigNode>) });
  }
  function asUserCanvas(): FigNode {
    return makeNode({ type: { value: 2, name: "CANVAS" }, name: "Page 1" });
  }
  function asDocument(): FigNode {
    return makeNode({ type: { value: 1, name: "DOCUMENT" }, name: "Doc" });
  }

  it("passes silently for a healthy node set", () => {
    const findings = runRule(requiredNodesRule, emptyContext({
      nodeChanges: [asDocument(), asUserCanvas(), asInternalCanvas({})],
    }));
    expect(findings).toEqual([]);
  });

  it("flags a missing DOCUMENT", () => {
    const findings = runRule(requiredNodesRule, emptyContext({
      nodeChanges: [asUserCanvas(), asInternalCanvas({})],
    }));
    const ids = ruleIdsOf(findings);
    expect(ids).toContain("fig.message.required-roots");
  });

  it("flags duplicate DOCUMENT nodes", () => {
    const findings = runRule(requiredNodesRule, emptyContext({
      nodeChanges: [asDocument(), asDocument(), asUserCanvas(), asInternalCanvas({})],
    }));
    const dup = findings.find((f) => f.message.includes("2 DOCUMENT"));
    expect(dup).toBeDefined();
  });

  it("flags missing user-visible canvas", () => {
    const findings = runRule(requiredNodesRule, emptyContext({
      nodeChanges: [asDocument(), asInternalCanvas({})],
    }));
    expect(findings.some((f) => f.message.includes("user-visible CANVAS"))).toBe(true);
  });

  it("flags missing Internal Only Canvas", () => {
    const findings = runRule(requiredNodesRule, emptyContext({
      nodeChanges: [asDocument(), asUserCanvas()],
    }));
    expect(ruleIdsOf(findings)).toContain("fig.canvas.internal-only");
  });
});

describe("shapeFieldsRule", () => {
  function frameMissingStroke(): FigNode {
    return makeNode({ type: { value: 4, name: "FRAME" }, name: "frame" });
  }
  function frameWithStroke(): FigNode {
    return makeNode({
      type: { value: 4, name: "FRAME" },
      name: "frame",
      strokeWeight: 1,
      strokeAlign: { value: STROKE_ALIGN_VALUES.INSIDE, name: "INSIDE" },
      strokeJoin: { value: STROKE_JOIN_VALUES.MITER, name: "MITER" },
    });
  }
  function group(): FigNode {
    return makeNode({ type: { value: 3, name: "GROUP" }, name: "g" });
  }
  function booleanOp(): FigNode {
    return makeNode({ type: { value: 5, name: "BOOLEAN_OPERATION" }, name: "b" });
  }

  it("emits three findings for a shape missing every stroke field", () => {
    const findings = runRule(shapeFieldsRule, emptyContext({ nodeChanges: [frameMissingStroke()] }));
    expect(findings).toHaveLength(3);
    const messages = findings.map((f) => f.message);
    expect(messages.some((m) => m.includes("strokeWeight"))).toBe(true);
    expect(messages.some((m) => m.includes("strokeAlign"))).toBe(true);
    expect(messages.some((m) => m.includes("strokeJoin"))).toBe(true);
  });

  it("emits nothing when stroke fields are present", () => {
    expect(runRule(shapeFieldsRule, emptyContext({ nodeChanges: [frameWithStroke()] }))).toEqual([]);
  });

  it("does not flag GROUP nodes (real Figma exports omit stroke fields)", () => {
    expect(runRule(shapeFieldsRule, emptyContext({ nodeChanges: [group()] }))).toEqual([]);
  });

  it("does not flag BOOLEAN_OPERATION nodes", () => {
    expect(runRule(shapeFieldsRule, emptyContext({ nodeChanges: [booleanOp()] }))).toEqual([]);
  });
});

describe("displayFieldsRule", () => {
  function frame(overrides: Partial<FigNode> = {}): FigNode {
    return makeNode({ type: { value: 4, name: "FRAME" }, name: "frame", ...overrides });
  }
  function document(): FigNode {
    return makeNode({ type: { value: 0, name: "DOCUMENT" }, name: "doc" });
  }

  it("emits two findings when both visible and opacity are absent", () => {
    const findings = runRule(displayFieldsRule, emptyContext({ nodeChanges: [frame()] }));
    expect(findings).toHaveLength(2);
    const messages = findings.map((f) => f.message);
    expect(messages.some((m) => m.includes("visible"))).toBe(true);
    expect(messages.some((m) => m.includes("opacity"))).toBe(true);
    for (const f of findings) {
      expect(f.ruleId).toBe("fig.shape.display-fields");
    }
  });

  it("emits one finding when only opacity is absent", () => {
    const findings = runRule(displayFieldsRule, emptyContext({ nodeChanges: [frame({ visible: true })] }));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("opacity");
  });

  it("emits one finding when only visible is absent", () => {
    const findings = runRule(displayFieldsRule, emptyContext({ nodeChanges: [frame({ opacity: 1 })] }));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("visible");
  });

  it("emits nothing when both fields are present", () => {
    const findings = runRule(
      displayFieldsRule,
      emptyContext({ nodeChanges: [frame({ visible: true, opacity: 1 })] }),
    );
    expect(findings).toEqual([]);
  });

  it("accepts visible: false (an intentionally hidden layer)", () => {
    const findings = runRule(
      displayFieldsRule,
      emptyContext({ nodeChanges: [frame({ visible: false, opacity: 1 })] }),
    );
    expect(findings).toEqual([]);
  });

  it("accepts opacity: 0 (an intentionally fully-transparent layer)", () => {
    const findings = runRule(
      displayFieldsRule,
      emptyContext({ nodeChanges: [frame({ visible: true, opacity: 0 })] }),
    );
    expect(findings).toEqual([]);
  });

  it("does not flag DOCUMENT — Figma's wire format omits display fields there", () => {
    expect(runRule(displayFieldsRule, emptyContext({ nodeChanges: [document()] }))).toEqual([]);
  });
});

describe("visibleBlobsRule", () => {
  function paintedRect(overrides: Partial<FigNode> = {}): FigNode {
    return makeNode({
      type: { value: 12, name: "ROUNDED_RECTANGLE" },
      size: { x: 50, y: 50 },
      fillPaints: [{ type: { value: PAINT_TYPE_VALUES.SOLID, name: "SOLID" }, color: { r: 1, g: 0, b: 0, a: 1 } }],
      ...overrides,
    });
  }
  function withFillGeometry(node: FigNode, blobIndex: number): FigNode {
    // `styleID: 0` is the load-bearing default real Figma exports
    // always emit on geometry entries — the lint rule requires it
    // alongside `commandsBlob` (see visible-blobs.ts).
    return { ...node, fillGeometry: [{ commandsBlob: blobIndex, windingRule: "NONZERO", styleID: 0 }] } as FigNode;
  }

  it("flags a visible paintable shape with no fillGeometry", () => {
    const findings = runRule(visibleBlobsRule, emptyContext({
      nodeChanges: [paintedRect()],
      message: { blobs: [] },
    }));
    expect(ruleIdsOf(findings)).toContain("fig.shape.fill-geometry");
  });

  it("does not flag invisible / zero-sized shapes", () => {
    const empty = paintedRect({ size: { x: 0, y: 0 } });
    expect(runRule(visibleBlobsRule, emptyContext({ nodeChanges: [empty] }))).toEqual([]);
  });

  it("flags out-of-range commandsBlob references", () => {
    const node = withFillGeometry(paintedRect(), 5);
    const findings = runRule(visibleBlobsRule, emptyContext({
      nodeChanges: [node],
      message: { blobs: [] }, // index 5 of an empty blob list — invalid
    }));
    expect(ruleIdsOf(findings)).toContain("fig.shape.fill-geometry");
    expect(findings[0].message).toMatch(/out of range/);
  });

  it("passes silently when geometry references resolve", () => {
    const node = withFillGeometry(paintedRect(), 0);
    const findings = runRule(visibleBlobsRule, emptyContext({
      nodeChanges: [node],
      message: { blobs: [{ bytes: [1, 2, 3] }] },
    }));
    expect(findings).toEqual([]);
  });
});

describe("parentRefsRule", () => {
  function nodeAt(localID: number, parent: { sessionID: number; localID: number } | null): FigNode {
    const base = makeNode({
      guid: { sessionID: 0, localID },
      type: { value: 4, name: "FRAME" },
      name: `n${localID}`,
    });
    if (!parent) {
      return base;
    }
    return { ...base, parentIndex: { guid: parent, position: "!" } } as FigNode;
  }

  it("does not flag DOCUMENT for missing parentIndex", () => {
    const doc = makeNode({ guid: { sessionID: 0, localID: 1 }, type: { value: 1, name: "DOCUMENT" } });
    expect(runRule(parentRefsRule, emptyContext({ nodeChanges: [doc] }))).toEqual([]);
  });

  it("flags non-DOCUMENT nodes that have no parentIndex", () => {
    const node = makeNode({ guid: { sessionID: 0, localID: 1 }, type: { value: 4, name: "FRAME" } });
    const findings = runRule(parentRefsRule, emptyContext({ nodeChanges: [node] }));
    expect(ruleIdsOf(findings)).toContain("fig.parent.refs");
  });

  it("flags dangling parent references", () => {
    const orphan = nodeAt(2, { sessionID: 0, localID: 99 });
    const findings = runRule(parentRefsRule, emptyContext({ nodeChanges: [orphan] }));
    expect(findings.some((f) => f.message.includes("0:99"))).toBe(true);
  });

  it("passes silently when the parent GUID is part of nodeChanges", () => {
    // Parent must be a DOCUMENT (the only node type the rule
    // exempts from the parentIndex check); the child resolves
    // back to it.
    const parentDoc = makeNode({ guid: { sessionID: 0, localID: 1 }, type: { value: 1, name: "DOCUMENT" } });
    const child = nodeAt(2, { sessionID: 0, localID: 1 });
    expect(runRule(parentRefsRule, emptyContext({ nodeChanges: [parentDoc, child] }))).toEqual([]);
  });
});

describe("imageRefsRule", () => {
  function imageNode(hash: readonly number[] | null): FigNode {
    const paint: Record<string, unknown> = { type: { value: 5, name: "IMAGE" } };
    if (hash) {
      paint.image = { hash };
    }
    return makeNode({ fillPaints: [paint as never] });
  }
  function pkgImage(ref: string): FigPackageImage {
    return { ref, data: new Uint8Array([1, 2, 3]), mimeType: "image/png" };
  }

  it("flags dangling image references", () => {
    const findings = runRule(imageRefsRule, emptyContext({
      isZip: true,
      nodeChanges: [imageNode([0xab, 0xcd, 0xef])],
      images: new Map(),
    }));
    expect(ruleIdsOf(findings)).toContain("fig.image.references");
    expect(findings[0].severity).toBe("error");
  });

  it("warns when an image is in the ZIP but no paint references it", () => {
    // The rule short-circuits on an empty nodeChanges list — supply
    // any node (without image paints) so it evaluates the
    // image-side orphan branch.
    const findings = runRule(imageRefsRule, emptyContext({
      isZip: true,
      nodeChanges: [makeNode({ name: "stub" })],
      images: new Map([["orphan-ref", pkgImage("orphan-ref")]]),
    }));
    const orphan = findings.find((f) => f.severity === "warning");
    expect(orphan?.ruleId).toBe("fig.image.references");
    expect(orphan?.path).toContain("orphan-ref");
  });

  it("passes silently when references resolve and no orphans exist", () => {
    const findings = runRule(imageRefsRule, emptyContext({
      isZip: true,
      nodeChanges: [imageNode([0xab, 0xcd, 0xef])],
      images: new Map([["abcdef", pkgImage("abcdef")]]),
    }));
    expect(findings).toEqual([]);
  });

  it("flags references in a non-zip input as errors", () => {
    const findings = runRule(imageRefsRule, emptyContext({
      isZip: false,
      nodeChanges: [imageNode([0xab, 0xcd, 0xef])],
      images: new Map(),
    }));
    expect(ruleIdsOf(findings)).toContain("fig.image.references");
    expect(findings[0].severity).toBe("error");
  });
});

describe("symbolInstanceRule", () => {
  function symbolNode(id: number, name: string, overrides: Partial<FigNode> = {}): FigNode {
    return makeNode({
      guid: { sessionID: 1, localID: id },
      type: { value: 15, name: "SYMBOL" },
      name,
      ...overrides,
    });
  }

  function childOf(parentLocalID: number, localID: number, overrides: Partial<FigNode> = {}): FigNode {
    return makeNode({
      guid: { sessionID: 1, localID },
      type: { value: 12, name: "ROUNDED_RECTANGLE" },
      name: `child-${localID}`,
      parentIndex: { guid: { sessionID: 1, localID: parentLocalID }, position: "!" },
      ...overrides,
    });
  }

  function instanceNode(id: number, symbolId: number, overrides: Partial<FigNode> = {}): FigNode {
    return makeNode({
      guid: { sessionID: 1, localID: id },
      type: { value: 16, name: "INSTANCE" },
      name: `instance-${id}`,
      symbolData: { symbolID: { sessionID: 1, localID: symbolId } },
      ...overrides,
    });
  }

  it("warns when a SYMBOL is resized by an INSTANCE but its children miss constraints", () => {
    const findings = runRule(
      symbolInstanceRule,
      emptyContext({
        nodeChanges: [
          symbolNode(100, "Button", { size: { x: 120, y: 44 } }),
          childOf(100, 101),
          // Instance with a different size — triggers the rule.
          instanceNode(200, 100, { size: { x: 80, y: 32 } }),
        ],
      }),
    );
    expect(ruleIdsOf(findings)).toContain("fig.symbol.child-constraints");
    const warning = findings.find((f) => f.ruleId === "fig.symbol.child-constraints");
    expect(warning?.severity).toBe("warning");
    expect(warning?.message).toMatch(/horizontalConstraint/);
    expect(warning?.message).toMatch(/verticalConstraint/);
  });

  it("does not warn when no INSTANCE actually resizes the SYMBOL", () => {
    // Children without constraints are fine when the symbol is
    // always rendered at its authored size — Figma exports look
    // exactly like this in the wild.
    const findings = runRule(
      symbolInstanceRule,
      emptyContext({
        nodeChanges: [
          symbolNode(100, "Button", { size: { x: 120, y: 44 } }),
          childOf(100, 101),
          instanceNode(200, 100, { size: { x: 120, y: 44 } }),
        ],
      }),
    );
    expect(findings.filter((f) => f.ruleId === "fig.symbol.child-constraints")).toEqual([]);
  });

  it("passes when SYMBOL children carry both constraints", () => {
    const findings = runRule(
      symbolInstanceRule,
      emptyContext({
        nodeChanges: [
          symbolNode(100, "Button", { size: { x: 120, y: 44 } }),
          childOf(100, 101, {
            horizontalConstraint: { value: 3, name: "STRETCH" },
            verticalConstraint: { value: 3, name: "STRETCH" },
          }),
          instanceNode(200, 100, { size: { x: 80, y: 32 } }),
        ],
      }),
    );
    expect(findings.filter((f) => f.ruleId === "fig.symbol.child-constraints")).toEqual([]);
  });

  it("skips constraint check on auto-layout SYMBOLs (stack mode drives sizing)", () => {
    const findings = runRule(
      symbolInstanceRule,
      emptyContext({
        nodeChanges: [
          symbolNode(100, "AutoLayoutSym", {
            stackMode: { value: 1, name: "HORIZONTAL" },
            size: { x: 120, y: 44 },
          }),
          childOf(100, 101),
          instanceNode(200, 100, { size: { x: 80, y: 32 } }),
        ],
      }),
    );
    expect(findings.filter((f) => f.ruleId === "fig.symbol.child-constraints")).toEqual([]);
  });

  it("emits error when an INSTANCE references an absent SYMBOL guid", () => {
    const findings = runRule(
      symbolInstanceRule,
      emptyContext({
        nodeChanges: [instanceNode(200, 999)],
      }),
    );
    const ref = findings.find((f) => f.ruleId === "fig.instance.symbol-ref");
    expect(ref?.severity).toBe("error");
    expect(ref?.message).toMatch(/1:999/);
  });

  it("emits error when an INSTANCE references a non-SYMBOL node", () => {
    const findings = runRule(
      symbolInstanceRule,
      emptyContext({
        nodeChanges: [
          makeNode({
            guid: { sessionID: 1, localID: 300 },
            type: { value: 4, name: "FRAME" },
            name: "not-a-symbol",
          }),
          instanceNode(301, 300),
        ],
      }),
    );
    const ref = findings.find((f) => f.ruleId === "fig.instance.symbol-ref");
    expect(ref?.severity).toBe("error");
    expect(ref?.message).toMatch(/expected SYMBOL/);
  });

  it("emits error when an INSTANCE has no symbolData at all", () => {
    const findings = runRule(
      symbolInstanceRule,
      emptyContext({
        nodeChanges: [
          makeNode({
            guid: { sessionID: 1, localID: 400 },
            type: { value: 16, name: "INSTANCE" },
            name: "no-ref",
          }),
        ],
      }),
    );
    const ref = findings.find((f) => f.ruleId === "fig.instance.symbol-ref");
    expect(ref?.severity).toBe("error");
    expect(ref?.message).toMatch(/no symbolData/);
  });

  it("passes for a complete SYMBOL+INSTANCE pair (resized, with constraints)", () => {
    const findings = runRule(
      symbolInstanceRule,
      emptyContext({
        nodeChanges: [
          symbolNode(100, "Button", { size: { x: 120, y: 44 } }),
          childOf(100, 101, {
            horizontalConstraint: { value: 3, name: "STRETCH" },
            verticalConstraint: { value: 3, name: "STRETCH" },
          }),
          instanceNode(200, 100, { size: { x: 180, y: 56 } }),
        ],
      }),
    );
    expect(findings).toEqual([]);
  });
});
