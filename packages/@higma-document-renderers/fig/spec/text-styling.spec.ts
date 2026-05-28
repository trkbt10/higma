/**
 * @file Visual binding for text-styling.fig (Phase 39 fixture).
 *
 * The fixture exercises every member of the text-styling enums
 * (`textCase`, `textDecoration`, `textAutoResize`, `textTruncation`,
 * `leadingTrim`, paragraph spacing / indent, per-run overrides) and
 * a CJK frame pinned to Noto Sans JP for deterministic rendering
 * across local + CI font environments.
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describeFixtureVisualBinding } from "./helpers/fixture-visual-binding";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "../fixtures/text-styling");

describeFixtureVisualBinding({
  id: "text-styling",
  fixtureRoot: FIXTURES_DIR,
  figFileName: "text-styling.fig",
  maxDiffPercent: 1.0,
});
