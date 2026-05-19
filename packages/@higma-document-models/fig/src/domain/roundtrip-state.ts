/**
 * @file Fig roundtrip state types retained by the domain document.
 *
 * Also owns the SoT for `Message.type` — the load-bearing enum value
 * that distinguishes a document-content `.fig` (`NODE_CHANGES`) from
 * session-sync messages Figma's importer rejects. Every consumer that
 * synthesises a `messageHeader` (currently only `exportFresh`) must
 * obtain the canonical header from `createNodeChangesMessageHeader`
 * — no hand-rolled `{value, name}` pairs.
 */

import type { KiwiSchema } from "@higma-codecs/kiwi/types";
import type { FigPackageImage, FigPackageMetadata } from "@higma-figma-containers/package";
import { requireFigEnumTable } from "@higma-figma-schema/profiles/schema";

import type { FigBlob } from "./blob-path";
import type { FigNode } from "../types";

// =============================================================================
// Message header
// =============================================================================

/**
 * Strict shape for `Message.type` in the canonical Figma Kiwi `Message`
 * struct. The schema's `MessageType` enum names: `NODE_CHANGES` for
 * document-content `.fig` files, `JOIN_START` / `JOIN_END` / `SIGNAL` /
 * etc. for session-sync messages. A `.fig` carrying a session-sync
 * `Message.type` is rejected by the importer with "Internal error during
 * import" — Figma reads the file expecting a document and finds session
 * traffic instead.
 */
export type FigMessageTypeName =
  | "JOIN_START"
  | "NODE_CHANGES"
  | "USER_CHANGES"
  | "JOIN_END"
  | "SIGNAL";

export type FigMessageType = {
  readonly value: number;
  readonly name: FigMessageTypeName;
};

/**
 * Canonical `Message`-header shape — the load-bearing per-file metadata
 * that wraps the document's `nodeChanges` / `blobs` payload.
 *
 * `LoadedFigFile.messageHeader` carries this shape, both for files
 * loaded from disk (where the header is decoded from the source) and
 * for fresh exports (where the header is synthesised via
 * `createNodeChangesMessageHeader`).
 */
export type FigMessageHeader = {
  readonly type: FigMessageType;
  readonly sessionID: number;
  readonly ackID: number;
};

// Resolve the `MessageType` enum at module load. Throws if the bundled
// schema is missing `NODE_CHANGES`, so a schema bump that drops the
// name fails fast — never silently mis-tags a fresh export.
const MESSAGE_TYPE_ENUM = requireFigEnumTable("MessageType", ["NODE_CHANGES"]);

/**
 * Optional inputs for a fresh document `Message` header.
 *
 * Defaults match what real Figma exports use when no live session is
 * involved: `sessionID = 1`, `ackID = 0`. Callers that need to align a
 * generated `.fig` with a specific live session can override either.
 */
export type CreateNodeChangesMessageHeaderOptions = {
  readonly sessionID?: number;
  readonly ackID?: number;
};

/**
 * Build the canonical `messageHeader` for a document-content `.fig`.
 *
 * This is the only sanctioned path for synthesising a header in fresh
 * exports — all consumers must call it rather than hand-roll the
 * `{value, name}` pair. The `value` comes from the bundled Kiwi schema
 * (resolved at module load), so a schema bump that renumbers
 * `MessageType` propagates here automatically without touching any
 * caller.
 */
export function createNodeChangesMessageHeader(
  options: CreateNodeChangesMessageHeaderOptions = {},
): FigMessageHeader {
  return {
    type: { value: MESSAGE_TYPE_ENUM.NODE_CHANGES, name: "NODE_CHANGES" },
    sessionID: options.sessionID ?? 1,
    ackID: options.ackID ?? 0,
  };
}

/**
 * Guard for loaded headers: rejects a `messageHeader` whose `type` is
 * anything other than `NODE_CHANGES`. Use this when handing a loaded
 * file off to a downstream consumer that requires document content
 * (e.g. the editor reducer). Session-sync messages are out of scope
 * for the editor pipeline and must be filtered upstream.
 */
export function assertNodeChangesMessageHeader(header: FigMessageHeader): void {
  if (header.type.name !== "NODE_CHANGES") {
    throw new Error(
      `Expected Message.type=NODE_CHANGES, got "${header.type.name}" ` +
      `(value=${header.type.value}). A .fig carrying session-sync messages ` +
      `cannot be opened as a document.`,
    );
  }
  if (header.type.value !== MESSAGE_TYPE_ENUM.NODE_CHANGES) {
    throw new Error(
      `Message.type.value=${header.type.value} does not match the bundled ` +
      `schema's NODE_CHANGES=${MESSAGE_TYPE_ENUM.NODE_CHANGES}; the file ` +
      `was encoded against a schema this build cannot read.`,
    );
  }
}

// =============================================================================
// Loaded file state
// =============================================================================

/**
 * Loaded fig-family file state preserved on a domain document for export.
 *
 * Image and metadata shapes are owned by `@higma-figma-containers/package`
 * (`FigPackageImage` / `FigPackageMetadata`) — the package SoT for what a
 * loaded `.fig` zip carries. Consumers must import those names directly from
 * `@higma-figma-containers/package`; domain does not re-publish them.
 */
export type LoadedFigFile = {
  readonly schema: KiwiSchema;
  readonly compressedSchema: Uint8Array;
  readonly version: string;
  readonly nodeChanges: readonly FigNode[];
  readonly blobs: readonly FigBlob[];
  readonly images: ReadonlyMap<string, FigPackageImage>;
  readonly metadata: FigPackageMetadata | null;
  readonly thumbnail: Uint8Array | null;
  readonly messageHeader: FigMessageHeader;
};
