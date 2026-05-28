/** @file Unit specs for `parseExtensionMessage`. */

import { parseExtensionMessage } from "./protocol-parse";

describe("parseExtensionMessage — rejection", () => {
  it("rejects non-object inputs", () => {
    expect(parseExtensionMessage(null)).toBeUndefined();
    expect(parseExtensionMessage(undefined)).toBeUndefined();
    expect(parseExtensionMessage("string")).toBeUndefined();
    expect(parseExtensionMessage(42)).toBeUndefined();
  });

  it("rejects unknown discriminators", () => {
    expect(parseExtensionMessage({ type: "no/such/message" })).toBeUndefined();
  });
});

describe("parseExtensionMessage — fig/loaded", () => {
  it("parses a wellformed payload", () => {
    expect(
      parseExtensionMessage({
        type: "fig/loaded",
        uri: "file://design.fig",
        fileName: "design.fig",
        bytesBase64: "AAAA",
      }),
    ).toEqual({
      type: "fig/loaded",
      uri: "file://design.fig",
      fileName: "design.fig",
      bytesBase64: "AAAA",
    });
  });

  it("rejects a fig/loaded missing a required field", () => {
    expect(
      parseExtensionMessage({
        type: "fig/loaded",
        uri: "file://design.fig",
        fileName: "design.fig",
        // bytesBase64 missing
      }),
    ).toBeUndefined();
  });
});

describe("parseExtensionMessage — fig/error", () => {
  it("parses a wellformed payload", () => {
    expect(
      parseExtensionMessage({ type: "fig/error", uri: "x", message: "boom" }),
    ).toEqual({ type: "fig/error", uri: "x", message: "boom" });
  });

  it("rejects when message is not a string", () => {
    expect(
      parseExtensionMessage({ type: "fig/error", uri: "x", message: 42 }),
    ).toBeUndefined();
  });
});

describe("parseExtensionMessage — viewer/config", () => {
  it("parses a wellformed config", () => {
    expect(
      parseExtensionMessage({
        type: "viewer/config",
        config: { exportDirectoryFsPath: "/tmp/a", exportDirectoryLabel: "a" },
      }),
    ).toEqual({
      type: "viewer/config",
      config: { exportDirectoryFsPath: "/tmp/a", exportDirectoryLabel: "a" },
    });
  });

  it("rejects when config is missing", () => {
    expect(parseExtensionMessage({ type: "viewer/config" })).toBeUndefined();
  });

  it("rejects when config has wrong-typed fields", () => {
    expect(
      parseExtensionMessage({
        type: "viewer/config",
        config: { exportDirectoryFsPath: 1, exportDirectoryLabel: "a" },
      }),
    ).toBeUndefined();
  });
});

describe("parseExtensionMessage — viewer/zoomCommand", () => {
  it("accepts the four known zoom commands", () => {
    for (const command of ["in", "out", "fit", "reset"] as const) {
      expect(parseExtensionMessage({ type: "viewer/zoomCommand", command })).toEqual({
        type: "viewer/zoomCommand",
        command,
      });
    }
  });

  it("rejects unknown commands", () => {
    expect(
      parseExtensionMessage({ type: "viewer/zoomCommand", command: "warp" }),
    ).toBeUndefined();
  });

  it("rejects non-string commands", () => {
    expect(
      parseExtensionMessage({ type: "viewer/zoomCommand", command: 1 }),
    ).toBeUndefined();
  });
});

describe("parseExtensionMessage — viewer/exportResult", () => {
  it("parses a saved outcome", () => {
    expect(
      parseExtensionMessage({
        type: "viewer/exportResult",
        requestId: "rid",
        fileName: "out.png",
        outcome: { kind: "saved", savedFsPath: "/tmp/out.png" },
      }),
    ).toEqual({
      type: "viewer/exportResult",
      requestId: "rid",
      fileName: "out.png",
      outcome: { kind: "saved", savedFsPath: "/tmp/out.png" },
    });
  });

  it("parses an error outcome", () => {
    expect(
      parseExtensionMessage({
        type: "viewer/exportResult",
        requestId: "rid",
        fileName: "out.png",
        outcome: { kind: "error", message: "permission denied" },
      }),
    ).toEqual({
      type: "viewer/exportResult",
      requestId: "rid",
      fileName: "out.png",
      outcome: { kind: "error", message: "permission denied" },
    });
  });

  it("rejects an outcome with an unknown kind", () => {
    expect(
      parseExtensionMessage({
        type: "viewer/exportResult",
        requestId: "rid",
        fileName: "out.png",
        outcome: { kind: "pending" },
      }),
    ).toBeUndefined();
  });

  it("rejects when outcome is missing", () => {
    expect(
      parseExtensionMessage({
        type: "viewer/exportResult",
        requestId: "rid",
        fileName: "out.png",
      }),
    ).toBeUndefined();
  });
});

describe("parseExtensionMessage — viewer/exportTokens", () => {
  it("parses the zero-payload sentinel", () => {
    expect(parseExtensionMessage({ type: "viewer/exportTokens" })).toEqual({
      type: "viewer/exportTokens",
    });
  });
});
