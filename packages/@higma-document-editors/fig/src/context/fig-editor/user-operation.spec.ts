/** @file Tests for Fig editor operation gates. */

import { allowsFigUserOperation, resolveFigUserOperationDomain } from "./user-operation";

describe("resolveFigUserOperationDomain", () => {
  it("allows select-mode operations that mutate selection and properties", () => {
    const domain = resolveFigUserOperationDomain({ kind: "select", mode: "select" });

    expect(allowsFigUserOperation(domain, "select-node")).toBe(true);
    expect(allowsFigUserOperation(domain, "move-node")).toBe(true);
    expect(allowsFigUserOperation(domain, "update-property")).toBe(true);
    expect(allowsFigUserOperation(domain, "delete-selection")).toBe(true);
    expect(allowsFigUserOperation(domain, "create-node")).toBe(false);
  });

  it("allows path editing without property mutation", () => {
    const domain = resolveFigUserOperationDomain({ kind: "path-edit", mode: "pen" });

    expect(allowsFigUserOperation(domain, "select-node")).toBe(true);
    expect(allowsFigUserOperation(domain, "edit-path")).toBe(true);
    expect(allowsFigUserOperation(domain, "update-property")).toBe(false);
  });

  it("allows creation intents only to create nodes", () => {
    const domain = resolveFigUserOperationDomain({ kind: "create", mode: "rectangle" });

    expect(allowsFigUserOperation(domain, "create-node")).toBe(true);
    expect(allowsFigUserOperation(domain, "select-node")).toBe(false);
  });
});
