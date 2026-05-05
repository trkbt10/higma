/**
 * @file Tests for explicit state node construction.
 */

import { createFigBuilderState } from "../types";
import { createNodeFromSpec } from "./node-factory";

describe("createNodeFromSpec", () => {
  it("requires explicit builder state for identifier allocation", () => {
    const state = createFigBuilderState({
      nodeIdCounter: { sessionID: 1, nextLocalID: 20 },
      pageIdCounter: { sessionID: 0, nextLocalID: 1 },
    });

    const node = createNodeFromSpec({
      state,
      spec: {
        type: "RECTANGLE",
        name: "Rectangle",
        x: 1,
        y: 2,
        width: 3,
        height: 4,
      },
    });

    expect(node.id).toBe("1:20");
    expect(createNodeFromSpec({
      state,
      spec: {
        type: "ELLIPSE",
        name: "Ellipse",
        x: 5,
        y: 6,
        width: 7,
        height: 8,
      },
    }).id).toBe("1:21");
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
