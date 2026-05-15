/**
 * @file Defensive-branch fail-fast guard.
 */

const counters = new Map<string, number>();

/** Error thrown when a defensive or heuristic branch is reached. */
export class DefensiveBranchError extends Error {
  readonly details: Record<string, unknown> | undefined;

  constructor(id: string, details: Record<string, unknown> | undefined) {
    const summary = details ? ` ${JSON.stringify(details)}` : "";
    super(`Defensive branch reached: ${id}${summary}`);
    this.name = "DefensiveBranchError";
    this.details = details;
  }
}

/**
 * Mark that a defensive / heuristic branch was exercised.
 *
 * Historically this threw `DefensiveBranchError` to fail-fast in tests
 * when a heuristic fired, on the assumption the heuristic's recovery
 * code path was unproven. Real-world Figma files (multi-author
 * community templates, files round-tripped between Figma versions)
 * routinely exercise these heuristics, and each call site below the
 * mark contains the documented recovery action that is the intended
 * production behaviour. Logging + incrementing the counter preserves
 * test introspection via `getDefensiveCounters()` while letting the
 * recovery run.
 */
export function defensiveMark(id: string, details?: Record<string, unknown>): void {
  counters.set(id, (counters.get(id) ?? 0) + 1);
  const summary = details ? ` ${JSON.stringify(details)}` : "";
  console.warn(`[higma] defensive branch fired: ${id}${summary}`);
}

/**
 * Snapshot of the current `id → fire count` map. The returned Map is
 * a copy — mutating it does not affect the live counters.
 */
export function getDefensiveCounters(): ReadonlyMap<string, number> {
  return new Map(counters);
}

/**
 * Wipe all counters and "first-hit" memory. Diagnostic scripts call
 * this between A/B passes so per-pass counts don't bleed.
 */
export function resetDefensiveCounters(): void {
  counters.clear();
}
