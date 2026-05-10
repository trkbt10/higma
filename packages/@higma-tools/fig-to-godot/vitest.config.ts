/**
 * @file Per-package vitest config for `@higma-tools/fig-to-godot`.
 *
 * The default vitest pool runs spec files in parallel; combined with
 * each spec spawning a Godot process for pixel-diff renders, that
 * produced fork storms (and OOM on memory-tight machines). Pinning
 * to a single worker serializes Godot launches — total wall-clock is
 * the same (each Godot batch is sequential anyway), and resident
 * memory stays bounded.
 *
 * Inherits the rest from the root config via Vitest's defaults.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Vitest 4 promoted pool options to top-level. `pool: "forks"` +
    // `forks: { singleFork: true }` runs every spec file in one
    // worker process, serializing Godot launches.
    pool: "forks",
    forks: {
      singleFork: true,
    },
  },
});
