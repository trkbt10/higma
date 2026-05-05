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
 * Fail immediately when a defensive or heuristic branch is exercised.
 */
export function defensiveMark(id: string, details?: Record<string, unknown>): void {
  counters.set(id, (counters.get(id) ?? 0) + 1);
  throw new DefensiveBranchError(id, details);
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
