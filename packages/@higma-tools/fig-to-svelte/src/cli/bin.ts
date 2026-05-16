#!/usr/bin/env bun
/**
 * @file Executable entry point for the fig-to-svelte CLI.
 *
 * The Svelte emit pipeline is not yet implemented; this stub exits
 * with a precise error so a caller wiring `fig-to-svelte` into their
 * toolchain sees a clear "not yet implemented" rather than silently
 * producing an empty output directory. The dependency graph and
 * `package.json` are already in place so the eventual implementation
 * can drop in next to fig-to-web without further structural churn.
 */
async function main(): Promise<void> {
  process.stderr.write(
    "fig-to-svelte: emit pipeline is not yet implemented (task #8 in the project task list).\n" +
    "Use fig-to-web in the meantime; it shares the same option surface (cssMode, exportStyle).\n",
  );
  process.exit(2);
}

void main();
