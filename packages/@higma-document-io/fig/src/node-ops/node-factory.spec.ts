/**
 * @file Tests for explicit state node construction.
 */

import { createFigBuilderState } from "@higma-document-models/fig/builder";
import { createNodeFromSpec } from "./node-factory";

describe("createNodeFromSpec", () => {
  it("requires explicit builder state for GUID allocation", () => {
    const state = createFigBuilderState({
      nodeGuidCounter: { sessionID: 1, nextLocalID: 20 },
      pageGuidCounter: { sessionID: 0, nextLocalID: 1 },
    });
    const parentGuid = { sessionID: 0, localID: 1 };

    const node = createNodeFromSpec({
      state,
      parentGuid,
      position: "!",
      spec: {
        type: "RECTANGLE",
        name: "Rectangle",
        x: 1,
        y: 2,
        width: 3,
        height: 4,
      },
    });

    expect(node.guid).toEqual({ sessionID: 1, localID: 20 });
    expect(createNodeFromSpec({
      state,
      parentGuid,
      position: "\"",
      spec: {
        type: "ELLIPSE",
        name: "Ellipse",
        x: 5,
        y: 6,
        width: 7,
        height: 8,
      },
    }).guid).toEqual({ sessionID: 1, localID: 21 });
  });

  it("fails when builder state is missing", () => {
    const invalidOptions = {
      spec: {
        type: "RECTANGLE",
        name: "Rectangle",
        x: 1,
        y: 2,
        width: 3,
        height: 4,
      },
    };

    expect(() => Reflect.apply(createNodeFromSpec, undefined, [invalidOptions])).toThrow(
      "createNodeFromSpec requires explicit builder state",
    );
  });
});
