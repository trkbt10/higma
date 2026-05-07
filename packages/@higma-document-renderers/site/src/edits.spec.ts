/**
 * @file Tests for CMS field edit application against fig-family node changes.
 */

import {
  applySiteCmsFieldEditsToNodeChanges,
  type SiteCmsFieldEdit,
} from "./edits";

type NodeRecord = Record<string, unknown>;

function makeTextNode(args: {
  readonly id: number;
  readonly characters: string;
  readonly aliasCollectionId: string;
  readonly aliasItemId: string;
  readonly aliasFieldId: string;
}): NodeRecord {
  return {
    type: { name: "TEXT" },
    guid: { sessionID: 0, localID: args.id },
    name: `Text ${args.id}`,
    textData: { characters: args.characters },
    parameterConsumptionMap: {
      entries: [
        {
          variableData: {
            value: {
              cmsAliasValue: {
                collectionId: args.aliasCollectionId,
                itemId: args.aliasItemId,
                fieldId: args.aliasFieldId,
              },
            },
            dataType: { name: "CMS_ALIAS" },
            resolvedDataType: { name: "JS_RUNTIME_ALIAS" },
          },
          variableField: { name: "TEXT_DATA" },
        },
      ],
    },
  };
}

describe("applySiteCmsFieldEditsToNodeChanges", () => {
  it("returns the original array when no edits are provided", () => {
    const nodes: readonly NodeRecord[] = [makeTextNode({
      id: 1,
      characters: "old",
      aliasCollectionId: "col",
      aliasItemId: "",
      aliasFieldId: "title",
    })];

    expect(applySiteCmsFieldEditsToNodeChanges(nodes, [])).toBe(nodes);
  });

  it("rewrites textData.characters on every consumer matching the edit triple", () => {
    const nodes: readonly NodeRecord[] = [
      makeTextNode({ id: 1, characters: "old", aliasCollectionId: "col", aliasItemId: "", aliasFieldId: "title" }),
      makeTextNode({ id: 2, characters: "old", aliasCollectionId: "col", aliasItemId: "", aliasFieldId: "title" }),
      makeTextNode({ id: 3, characters: "untouched", aliasCollectionId: "col", aliasItemId: "", aliasFieldId: "body" }),
      makeTextNode({ id: 4, characters: "different item", aliasCollectionId: "col", aliasItemId: "other", aliasFieldId: "title" }),
    ];
    const edits: readonly SiteCmsFieldEdit[] = [
      { collectionId: "col", itemId: "", fieldId: "title", text: "new" },
    ];

    const updated = applySiteCmsFieldEditsToNodeChanges(nodes, edits);

    expect((updated[0]?.textData as Record<string, unknown> | undefined)?.characters).toBe("new");
    expect((updated[1]?.textData as Record<string, unknown> | undefined)?.characters).toBe("new");
    expect((updated[2]?.textData as Record<string, unknown> | undefined)?.characters).toBe("untouched");
    expect((updated[3]?.textData as Record<string, unknown> | undefined)?.characters).toBe("different item");
  });

  it("ignores nodes whose alias variableField is not TEXT_DATA", () => {
    const richTextNode: NodeRecord = {
      type: { name: "CMS_RICH_TEXT" },
      guid: { sessionID: 0, localID: 1 },
      name: "Rich",
      textData: { characters: "old" },
      parameterConsumptionMap: {
        entries: [
          {
            variableData: {
              value: { cmsAliasValue: { collectionId: "col", itemId: "", fieldId: "body" } },
              dataType: { name: "CMS_ALIAS" },
              resolvedDataType: { name: "JS_RUNTIME_ALIAS" },
            },
            variableField: { name: "CMS_SERIALIZED_RICH_TEXT_DATA" },
          },
        ],
      },
    };
    const edits: readonly SiteCmsFieldEdit[] = [
      { collectionId: "col", itemId: "", fieldId: "body", text: "new" },
    ];

    const updated = applySiteCmsFieldEditsToNodeChanges([richTextNode], edits);

    expect((updated[0]?.textData as Record<string, unknown> | undefined)?.characters).toBe("old");
  });
});
