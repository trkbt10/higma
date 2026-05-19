/**
 * @file Smoke-test the variant explosion routines.
 *
 * The variant-explosion code paths in `files.ts` are private to the
 * module; the routines most worth pinning are the slug derivations
 * because their output appears in both the file path and the
 * component name and any drift between the two breaks the barrel's
 * imports.
 *
 * The path / Pascal-case routines are exported only via the variant
 * file-path computation surface; we test them indirectly through a
 * minimal `emitComponentFile` call with `variantStrategy: "exploded"`
 * and a stub ComponentTarget. The stub builds the minimum FigNode
 * shape the emit pipeline needs to reach the per-variant emit branch
 * without exercising deeper layout / style code paths.
 */
import type { FigNode, KiwiEnumValue } from "@higma-document-models/fig/types";
import type { ComponentTarget, EmitRegistry } from "../types";
import type { TokenIndex } from "../../tokens";
import type { FigDocumentContext } from "@higma-document-io/fig/context";
import { createFigDocumentContextFromNodeChanges } from "@higma-document-io/fig/context";
import type { EmitOpts } from "./files";
import { emitComponentFile } from "./files";

function enumName<T extends string>(name: T): KiwiEnumValue<T> {
  return { value: 0, name } as KiwiEnumValue<T>;
}

function variantSymbol(localID: number, name: string, parentLocalID: number, position: number): FigNode {
  return {
    guid: { sessionID: 1, localID },
    parentIndex: {
      guid: { sessionID: 1, localID: parentLocalID },
      position: `${position}`,
    },
    phase: enumName("CREATED"),
    type: enumName("SYMBOL"),
    name,
    size: { x: 100, y: 40 },
  } as FigNode;
}

function makeVariantSet(): { readonly source: FigDocumentContext; readonly target: ComponentTarget } {
  const setFrame: FigNode = {
    guid: { sessionID: 1, localID: 100 },
    phase: enumName("CREATED"),
    type: enumName("FRAME"),
    name: "Button",
    size: { x: 100, y: 40 },
  } as FigNode;
  const onVariant = variantSymbol(101, "Variant=On", 100, 0);
  const offVariant = variantSymbol(102, "Variant=Off", 100, 1);
  const source = createFigDocumentContextFromNodeChanges({
    nodeChanges: [setFrame, onVariant, offVariant],
    blobs: [],
    images: new Map(),
    metadata: null,
  });
  return {
    source,
    target: {
      node: setFrame,
      componentName: "Button",
      filePath: "components/Design/Button.tsx",
      slug: "button",
      canvasSlug: "design",
      variants: new Map([
        ["On", onVariant],
        ["Off", offVariant],
      ]),
      props: [
        {
          kind: "variant",
          name: "variant",
          defId: "variant-def",
          values: ["On", "Off"],
          defaultValue: "On",
        },
      ],
    },
  };
}

function makeOpts(): EmitOpts {
  return {
    debugAttrs: false,
    imageResolver: () => undefined,
    exportStyle: "function-default",
    cssMode: "inline",
    cssImport: "direct",
    externalCssRegistry: undefined,
    externalStylesheetPath: "styles.css",
    variantStrategy: "exploded",
    assetStrategy: "inline",
    assetComplexityThreshold: 200,
    iconRegistry: undefined,
  };
}

const EMPTY_REGISTRY: EmitRegistry = {
  frames: new Map(),
  components: new Map(),
};
const EMPTY_TOKEN_INDEX: TokenIndex = {
  colorIdForPaints: () => undefined,
  spacingIdFor: () => undefined,
  radiusIdFor: () => undefined,
  shadowIdFor: () => undefined,
  typographyIdFor: () => undefined,
};

describe("emitComponentFile with variantStrategy: exploded", () => {
  it("emits one TSX per variant plus a barrel that re-exports them", () => {
    const variantSet = makeVariantSet();
    const files = emitComponentFile(variantSet.source, EMPTY_REGISTRY, EMPTY_TOKEN_INDEX, variantSet.target, makeOpts());
    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual([
      "components/Design/Button-off.tsx",
      "components/Design/Button-on.tsx",
      "components/Design/Button.tsx",
    ]);

    const onFile = files.find((f) => f.path === "components/Design/Button-on.tsx");
    if (!onFile) {
      throw new Error("missing Button-on.tsx");
    }
    expect(onFile.contents).toMatch(/export function ButtonOn\(/);
    // The exploded variant component drops the variant axis from
    // props — only non-variant decls should land here.
    expect(onFile.contents).not.toMatch(/"variant"\?:/);

    const barrel = files.find((f) => f.path === "components/Design/Button.tsx");
    if (!barrel) {
      throw new Error("missing barrel");
    }
    // Barrel imports the per-variant components, re-exports them,
    // and switches on the variant prop to delegate.
    expect(barrel.contents).toMatch(/import { ButtonOn } from "\.\/Button-on";/);
    expect(barrel.contents).toMatch(/import { ButtonOff } from "\.\/Button-off";/);
    expect(barrel.contents).toMatch(/export { ButtonOn, ButtonOff };/);
    expect(barrel.contents).toMatch(/case "On":/);
    expect(barrel.contents).toMatch(/return <ButtonOn \/>/);
    expect(barrel.contents).toMatch(/case "Off":/);
    expect(barrel.contents).toMatch(/return <ButtonOff \/>/);
  });

  it("emits a single discriminated component when variantStrategy is discriminated", () => {
    const variantSet = makeVariantSet();
    const files = emitComponentFile(
      variantSet.source,
      EMPTY_REGISTRY,
      EMPTY_TOKEN_INDEX,
      variantSet.target,
      { ...makeOpts(), variantStrategy: "discriminated" },
    );
    expect(files.map((f) => f.path)).toEqual(["components/Design/Button.tsx"]);
    const sole = files[0];
    if (!sole) {
      throw new Error("missing file");
    }
    expect(sole.contents).toMatch(/switch \(variant\)/);
    // Discriminated mode keeps the original switch body — no
    // per-variant component imports.
    expect(sole.contents).not.toMatch(/from "\.\/Button-on"/);
  });
});
