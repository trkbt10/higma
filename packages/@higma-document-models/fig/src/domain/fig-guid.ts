/**
 * @file Fig GUID primitives shared by Kiwi document consumers.
 */
import type { FigGuid } from "../types";

/**
 * Convert a Kiwi GUID tuple into its stable string map key.
 */
export function guidToString(guid: FigGuid): string {
  return `${guid.sessionID}:${guid.localID}`;
}

/**
 * Narrow an unknown value to the Kiwi GUID shape.
 */
export function isFigGuid(value: unknown): value is FigGuid {
  return typeof value === "object"
    && value !== null
    && "sessionID" in value
    && typeof value.sessionID === "number"
    && "localID" in value
    && typeof value.localID === "number";
}
