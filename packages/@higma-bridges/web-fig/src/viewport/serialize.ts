/**
 * @file ViewportIR ↔ on-disk JSON form.
 *
 * The IR carries `Uint8Array` asset bytes which JSON cannot round-trip;
 * the serialized form holds base64 instead. This is the canonical
 * fixture format used by the round-trip spec — keeping it as a single
 * SoT here means tests, snapshot checks, and future debugging tools
 * agree on the encoding.
 */
import type { AssetIR, ViewportIR } from "../ir/types";

export type ViewportFixtureJson = {
  readonly source: string;
  readonly breakpoint: string;
  readonly devicePixelRatio: number;
  readonly background: ViewportIR["background"];
  readonly box: ViewportIR["box"];
  readonly root: ViewportIR["root"];
  /** Lifted-out `position: fixed` / `sticky` descendants that paint at viewport-anchored coordinates. */
  readonly viewportLayer: ViewportIR["viewportLayer"];
  readonly assets: ReadonlyArray<{
    readonly id: string;
    readonly mime: AssetIR["mime"];
    readonly base64: string;
  }>;
};

/** Serialise a ViewportIR (with binary asset bytes) into a JSON-friendly fixture form. */
export function serializeViewport(viewport: ViewportIR): ViewportFixtureJson {
  const assets: Array<{ readonly id: string; readonly mime: AssetIR["mime"]; readonly base64: string }> = [];
  for (const asset of viewport.assets.values()) {
    assets.push({
      id: asset.id,
      mime: asset.mime,
      base64: bytesToBase64(asset.bytes),
    });
  }
  return {
    source: viewport.source,
    breakpoint: viewport.breakpoint,
    devicePixelRatio: viewport.devicePixelRatio,
    background: viewport.background,
    box: viewport.box,
    root: viewport.root,
    viewportLayer: viewport.viewportLayer,
    assets,
  };
}

/** Inverse of `serializeViewport` — re-hydrates the fixture form into a runtime ViewportIR. */
export function deserializeViewport(json: ViewportFixtureJson): ViewportIR {
  const assets = new Map<string, AssetIR>();
  for (const a of json.assets) {
    assets.set(a.id, { id: a.id, mime: a.mime, bytes: base64ToBytes(a.base64) });
  }
  return {
    source: json.source,
    breakpoint: json.breakpoint,
    devicePixelRatio: json.devicePixelRatio,
    background: json.background,
    box: json.box,
    root: json.root,
    viewportLayer: json.viewportLayer,
    assets,
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  return btoa(bytesToBinaryString(bytes));
}

function bytesToBinaryString(bytes: Uint8Array): string {
  const chunk = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunk) {
    parts.push(String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length))));
  }
  return parts.join("");
}

function base64ToBytes(input: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    const buf = Buffer.from(input, "base64");
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const binary = atob(input);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}
