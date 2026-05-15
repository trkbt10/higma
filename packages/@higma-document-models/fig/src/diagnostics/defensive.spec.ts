/**
 * @file Pin the post-fix contract of `defensiveMark`.
 *
 * Pre-fix: every heuristic-guard call site threw
 * `DefensiveBranchError`, which dead-code-eliminated the recovery
 * action documented at the same call site and aborted conversion on
 * real-world Figma files that legitimately exercised the heuristic.
 * Post-fix: the mark increments its counter (so test introspection
 * via `getDefensiveCounters()` still works) and the call returns
 * normally, letting the recovery run.
 *
 * `DefensiveBranchError` itself remains exported so existing
 * consumers that catch it (and any future opt-in strict mode) keep
 * compiling.
 */
import {
  DefensiveBranchError,
  defensiveMark,
  getDefensiveCounters,
  resetDefensiveCounters,
} from "./defensive";

describe("defensiveMark", () => {
  beforeEach(() => {
    resetDefensiveCounters();
  });

  it("does not throw when a defensive branch fires", () => {
    expect(() => defensiveMark("test:branch-a")).not.toThrow();
    expect(() => defensiveMark("test:branch-b", { reason: "x" })).not.toThrow();
  });

  it("increments the counter once per call", () => {
    defensiveMark("test:branch-c");
    defensiveMark("test:branch-c");
    defensiveMark("test:branch-c");
    expect(getDefensiveCounters().get("test:branch-c")).toBe(3);
  });

  it("tracks distinct ids independently", () => {
    defensiveMark("test:branch-d");
    defensiveMark("test:branch-e");
    defensiveMark("test:branch-d");
    const counters = getDefensiveCounters();
    expect(counters.get("test:branch-d")).toBe(2);
    expect(counters.get("test:branch-e")).toBe(1);
  });

  it("still exports DefensiveBranchError for catch-site compatibility", () => {
    const err = new DefensiveBranchError("test:branch-f", { k: "v" });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("DefensiveBranchError");
    expect(err.details).toEqual({ k: "v" });
  });
});
