/**
 * @file Public types for the fig-file health check (lint).
 *
 * The lint inspects an in-memory `.fig` byte buffer and produces a
 * report describing every reason the file would fail to round-trip
 * through Figma's importer. Rules are pure: they take a `LintContext`
 * (built once per run) and append findings to a list. No I/O, no
 * mutations, no throws — every problem is structured data so a CLI,
 * test, or CI gate can render it the way it needs.
 */

import type { KiwiSchema } from "@higma-codecs/kiwi/types";
import type { FigCanvasHeader } from "@higma-figma-containers/canvas";
import type { FigPackageImage, FigPackageMetadata } from "@higma-figma-containers/package";
import type { FigNode } from "@higma-document-models/fig/types";

/**
 * Severity of a lint finding.
 *
 * - `error` — Figma will reject the file or the structural invariant
 *   the project relies on is broken. Must be fixed.
 * - `warning` — File loads, but the result is degraded (missing
 *   thumbnail, missing internal canvas, etc.).
 * - `info` — Diagnostic-only observation that does not need action.
 */
export type LintSeverity = "error" | "warning" | "info";

/**
 * Stable identifier for a lint rule.
 *
 * The string is a dotted slug suitable for `--disable`, CI message
 * filtering, and grep. Keep it stable across versions — the IDs are
 * the public contract.
 */
export type LintRuleId =
  | "fig.zip.header"
  | "fig.zip.canvas-entry"
  | "fig.zip.thumbnail"
  | "fig.zip.meta"
  | "fig.canvas.header"
  | "fig.canvas.payload-size"
  | "fig.canvas.version"
  | "fig.schema.coverage"
  | "fig.schema.required-types"
  | "fig.message.decode"
  | "fig.message.required-roots"
  | "fig.message.type"
  | "fig.canvas.internal-only"
  | "fig.shape.stroke-fields"
  | "fig.shape.fill-geometry"
  | "fig.image.references"
  | "fig.parent.refs"
  | "fig.symbol.child-constraints"
  | "fig.instance.symbol-ref";

/**
 * One reported issue.
 *
 * `path` is a human-readable JSON-ish location ("nodes[3].strokeWeight",
 * "zip/canvas.fig", "schema/Message"). `remediation` is a short hint
 * describing how to fix the issue, intended for the CLI output.
 */
export type LintFinding = {
  readonly ruleId: LintRuleId;
  readonly severity: LintSeverity;
  readonly message: string;
  readonly path: string;
  readonly remediation?: string;
};

/**
 * Full lint report for one file.
 *
 * `inputBytes` is the size of the input in bytes (after read). `valid`
 * is true iff the file has no `error`-severity findings.
 */
export type FigHealthReport = {
  readonly valid: boolean;
  readonly inputBytes: number;
  readonly findings: readonly LintFinding[];
  readonly summary: FigHealthSummary;
};

export type FigHealthSummary = {
  readonly errors: number;
  readonly warnings: number;
  readonly infos: number;
};

/**
 * Context shared between lint rules.
 *
 * The fields are all optional because earlier-stage rules can fail
 * (e.g., zip parse failure) — later rules then have less data to
 * inspect. Each rule is responsible for guarding on the fields it
 * needs and emitting `info`-level skips when data is missing.
 */
export type LintContext = {
  readonly bytes: Uint8Array;
  /** True when the input looks like a ZIP-wrapped fig package. */
  readonly isZip: boolean;
  /** Raw entries inside the ZIP, by name. Empty when not a zip. */
  readonly zipEntries: ReadonlyMap<string, Uint8Array>;
  /** Raw canvas.fig contents (post zip extraction, or input itself). */
  readonly canvasData: Uint8Array | null;
  /** Decoded canvas header, when canvasData is parseable. */
  readonly canvasHeader: FigCanvasHeader | null;
  /** Decoded schema, when the schema chunk is parseable. */
  readonly schema: KiwiSchema | null;
  /** Decoded message, when schema decoding succeeded. */
  readonly message: Record<string, unknown> | null;
  /** nodeChanges array from the message. */
  readonly nodeChanges: readonly FigNode[];
  /** Image entries discovered in the ZIP. */
  readonly images: ReadonlyMap<string, FigPackageImage>;
  /** Parsed meta.json contents from the ZIP. */
  readonly metadata: FigPackageMetadata | null;
  /** Whether the ZIP contains a thumbnail.png entry. */
  readonly hasThumbnail: boolean;
};

/** A lint rule appends zero or more findings into the supplied sink. */
export type LintRule = (ctx: LintContext, emit: (finding: LintFinding) => void) => void;
