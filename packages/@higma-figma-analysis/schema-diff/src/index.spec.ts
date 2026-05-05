/**
 * @file Schema diff contract tests.
 */

import type { KiwiSchema } from "@higma-codecs/kiwi/types";

import { diffKiwiSchemaDefinitions } from ".";

const baseSchema: KiwiSchema = {
  definitions: [
    { name: "Message", kind: "MESSAGE", fields: [] },
    { name: "NodeChange", kind: "MESSAGE", fields: [] },
  ],
};

const candidateSchema: KiwiSchema = {
  definitions: [
    { name: "Message", kind: "MESSAGE", fields: [] },
    { name: "Scene3d", kind: "MESSAGE", fields: [] },
  ],
};

describe("diffKiwiSchemaDefinitions", () => {
  it("reports added and removed schema definitions", () => {
    expect(diffKiwiSchemaDefinitions(baseSchema, candidateSchema)).toEqual({
      addedDefinitions: ["Scene3d"],
      removedDefinitions: ["NodeChange"],
    });
  });
});
