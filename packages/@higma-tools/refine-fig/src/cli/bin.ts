#!/usr/bin/env bun
/**
 * @file refine-fig CLI bin shim.
 */
import { runCli } from "./run";

runCli(process.argv.slice(2)).then(
  () => process.exit(0),
  (err) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  },
);
