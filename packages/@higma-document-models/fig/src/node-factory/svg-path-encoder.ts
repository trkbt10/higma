/**
 * @file Encode SVG path `d` strings into Figma's fillGeometry blob
 * format.
 *
 * Format confirmed against Figma's own `.fig` exports (Youtube UI Kit
 * VECTOR nodes, ~280 samples):
 *
 *   - Byte 0     : 0x01 (header / version marker)
 *   - Bytes 1-8  : Start position (two float32, little-endian)
 *   - Then       : sequence of `cmd` + payload triples, terminated by
 *                  a single 0x00 padding byte.
 *
 * Command codes (matches `encodeRectangleBlob`):
 *   - 0x02 : LineTo  — payload (x, y) as 8 bytes
 *   - 0x04 : CubicTo — payload (cp1x, cp1y, cp2x, cp2y, x, y) as 24 bytes
 *
 * SVG commands handled: M m L l H h V v C c S s Q q T t Z z A a (arcs
 * flattened to cubics via the primitive `arcToCubicBeziers` routine).
 */

import { arcToCubicBeziers } from "@higma-primitives/path";

const CMD_LINE_TO = 0x02;
const CMD_CUBIC_TO = 0x04;

type Cursor = {
  x: number;
  y: number;
  startX: number;
  startY: number;
  prevControlX: number;
  prevControlY: number;
  prevCmd: string;
};

export type SvgPathBlobResult = {
  readonly bytes: readonly number[];
};

/**
 * Reflected control point for a smooth cubic ("S" / "s") command.
 *
 * When the previous command was C/S, SVG reflects the previous cubic's
 * second control point through the current point to act as the implicit
 * first control point. Otherwise the implicit control point coincides
 * with the current point.
 */
function reflectedCubicControlPoint(cursor: Cursor): { x: number; y: number } {
  if (cursor.prevCmd === "C" || cursor.prevCmd === "S") {
    return { x: cursor.x * 2 - cursor.prevControlX, y: cursor.y * 2 - cursor.prevControlY };
  }
  return { x: cursor.x, y: cursor.y };
}

/**
 * Reflected control point for a smooth quadratic ("T" / "t") command.
 * Same idea as `reflectedCubicControlPoint` but for Q/T continuity.
 */
function reflectedQuadraticControlPoint(cursor: Cursor): { x: number; y: number } {
  if (cursor.prevCmd === "Q" || cursor.prevCmd === "T") {
    return { x: cursor.x * 2 - cursor.prevControlX, y: cursor.y * 2 - cursor.prevControlY };
  }
  return { x: cursor.x, y: cursor.y };
}






export function encodeSvgPathBlob(d: string): SvgPathBlobResult {
  const tokens = tokenizePathD(d);
  const bytes: number[] = [];
  bytes.push(0x01);
  const cursor: Cursor = {
    x: 0,
    y: 0,
    startX: 0,
    startY: 0,
    prevControlX: 0,
    prevControlY: 0,
    prevCmd: "",
  };
  let started = false;
  function ensureStarted(): void {
    if (started) {
      return;
    }
    pushFloat32(bytes, cursor.x);
    pushFloat32(bytes, cursor.y);
    cursor.startX = cursor.x;
    cursor.startY = cursor.y;
    started = true;
  }
  for (const token of tokens) {
    const cmd = token.cmd;
    const args = token.args;
    switch (cmd) {
      case "M":
      case "m": {
        const isRelative = cmd === "m";
        let i = 0;
        const tx = args[i++]!;
        const ty = args[i++]!;
        cursor.x = isRelative ? cursor.x + tx : tx;
        cursor.y = isRelative ? cursor.y + ty : ty;
        cursor.startX = cursor.x;
        cursor.startY = cursor.y;
        if (!started) {
          pushFloat32(bytes, cursor.x);
          pushFloat32(bytes, cursor.y);
          started = true;
        } else {
          // Sub-path opener — emit a connector LineTo so the blob
          // remains a single polyline (Figma's fillGeometry slot
          // takes one continuous path).
          bytes.push(CMD_LINE_TO);
          pushFloat32(bytes, cursor.x);
          pushFloat32(bytes, cursor.y);
        }
        // Subsequent pairs after `M` are implicit LineTo.
        while (i + 1 < args.length) {
          const x = args[i++]!;
          const y = args[i++]!;
          cursor.x = isRelative ? cursor.x + x : x;
          cursor.y = isRelative ? cursor.y + y : y;
          bytes.push(CMD_LINE_TO);
          pushFloat32(bytes, cursor.x);
          pushFloat32(bytes, cursor.y);
        }
        cursor.prevCmd = "M";
        cursor.prevControlX = cursor.x;
        cursor.prevControlY = cursor.y;
        break;
      }
      case "L":
      case "l": {
        const isRelative = cmd === "l";
        for (let j = 0; j + 1 < args.length; j += 2) {
          const x = args[j]!;
          const y = args[j + 1]!;
          cursor.x = isRelative ? cursor.x + x : x;
          cursor.y = isRelative ? cursor.y + y : y;
          ensureStarted();
          bytes.push(CMD_LINE_TO);
          pushFloat32(bytes, cursor.x);
          pushFloat32(bytes, cursor.y);
        }
        cursor.prevCmd = "L";
        cursor.prevControlX = cursor.x;
        cursor.prevControlY = cursor.y;
        break;
      }
      case "H":
      case "h": {
        const isRelative = cmd === "h";
        for (const x of args) {
          cursor.x = isRelative ? cursor.x + x : x;
          ensureStarted();
          bytes.push(CMD_LINE_TO);
          pushFloat32(bytes, cursor.x);
          pushFloat32(bytes, cursor.y);
        }
        cursor.prevCmd = "L";
        cursor.prevControlX = cursor.x;
        cursor.prevControlY = cursor.y;
        break;
      }
      case "V":
      case "v": {
        const isRelative = cmd === "v";
        for (const y of args) {
          cursor.y = isRelative ? cursor.y + y : y;
          ensureStarted();
          bytes.push(CMD_LINE_TO);
          pushFloat32(bytes, cursor.x);
          pushFloat32(bytes, cursor.y);
        }
        cursor.prevCmd = "L";
        cursor.prevControlX = cursor.x;
        cursor.prevControlY = cursor.y;
        break;
      }
      case "C":
      case "c": {
        const isRelative = cmd === "c";
        for (let j = 0; j + 5 < args.length; j += 6) {
          const cp1x = isRelative ? cursor.x + args[j]! : args[j]!;
          const cp1y = isRelative ? cursor.y + args[j + 1]! : args[j + 1]!;
          const cp2x = isRelative ? cursor.x + args[j + 2]! : args[j + 2]!;
          const cp2y = isRelative ? cursor.y + args[j + 3]! : args[j + 3]!;
          const x = isRelative ? cursor.x + args[j + 4]! : args[j + 4]!;
          const y = isRelative ? cursor.y + args[j + 5]! : args[j + 5]!;
          ensureStarted();
          bytes.push(CMD_CUBIC_TO);
          pushFloat32(bytes, cp1x);
          pushFloat32(bytes, cp1y);
          pushFloat32(bytes, cp2x);
          pushFloat32(bytes, cp2y);
          pushFloat32(bytes, x);
          pushFloat32(bytes, y);
          cursor.prevControlX = cp2x;
          cursor.prevControlY = cp2y;
          cursor.x = x;
          cursor.y = y;
        }
        cursor.prevCmd = "C";
        break;
      }
      case "S":
      case "s": {
        const isRelative = cmd === "s";
        for (let j = 0; j + 3 < args.length; j += 4) {
          const reflected = reflectedCubicControlPoint(cursor);
          const cp1x = reflected.x;
          const cp1y = reflected.y;
          const cp2x = isRelative ? cursor.x + args[j]! : args[j]!;
          const cp2y = isRelative ? cursor.y + args[j + 1]! : args[j + 1]!;
          const x = isRelative ? cursor.x + args[j + 2]! : args[j + 2]!;
          const y = isRelative ? cursor.y + args[j + 3]! : args[j + 3]!;
          ensureStarted();
          bytes.push(CMD_CUBIC_TO);
          pushFloat32(bytes, cp1x);
          pushFloat32(bytes, cp1y);
          pushFloat32(bytes, cp2x);
          pushFloat32(bytes, cp2y);
          pushFloat32(bytes, x);
          pushFloat32(bytes, y);
          cursor.prevControlX = cp2x;
          cursor.prevControlY = cp2y;
          cursor.x = x;
          cursor.y = y;
        }
        cursor.prevCmd = "S";
        break;
      }
      case "Q":
      case "q": {
        const isRelative = cmd === "q";
        for (let j = 0; j + 3 < args.length; j += 4) {
          const qx = isRelative ? cursor.x + args[j]! : args[j]!;
          const qy = isRelative ? cursor.y + args[j + 1]! : args[j + 1]!;
          const x = isRelative ? cursor.x + args[j + 2]! : args[j + 2]!;
          const y = isRelative ? cursor.y + args[j + 3]! : args[j + 3]!;
          // Convert quadratic to cubic via the standard 2/3 rule.
          const cp1x = cursor.x + (qx - cursor.x) * (2 / 3);
          const cp1y = cursor.y + (qy - cursor.y) * (2 / 3);
          const cp2x = x + (qx - x) * (2 / 3);
          const cp2y = y + (qy - y) * (2 / 3);
          ensureStarted();
          bytes.push(CMD_CUBIC_TO);
          pushFloat32(bytes, cp1x);
          pushFloat32(bytes, cp1y);
          pushFloat32(bytes, cp2x);
          pushFloat32(bytes, cp2y);
          pushFloat32(bytes, x);
          pushFloat32(bytes, y);
          cursor.prevControlX = qx;
          cursor.prevControlY = qy;
          cursor.x = x;
          cursor.y = y;
        }
        cursor.prevCmd = "Q";
        break;
      }
      case "T":
      case "t": {
        const isRelative = cmd === "t";
        for (let j = 0; j + 1 < args.length; j += 2) {
          const reflected = reflectedQuadraticControlPoint(cursor);
          const qx = reflected.x;
          const qy = reflected.y;
          const x = isRelative ? cursor.x + args[j]! : args[j]!;
          const y = isRelative ? cursor.y + args[j + 1]! : args[j + 1]!;
          const cp1x = cursor.x + (qx - cursor.x) * (2 / 3);
          const cp1y = cursor.y + (qy - cursor.y) * (2 / 3);
          const cp2x = x + (qx - x) * (2 / 3);
          const cp2y = y + (qy - y) * (2 / 3);
          ensureStarted();
          bytes.push(CMD_CUBIC_TO);
          pushFloat32(bytes, cp1x);
          pushFloat32(bytes, cp1y);
          pushFloat32(bytes, cp2x);
          pushFloat32(bytes, cp2y);
          pushFloat32(bytes, x);
          pushFloat32(bytes, y);
          cursor.prevControlX = qx;
          cursor.prevControlY = qy;
          cursor.x = x;
          cursor.y = y;
        }
        cursor.prevCmd = "T";
        break;
      }
      case "A":
      case "a": {
        const isRelative = cmd === "a";
        for (let j = 0; j + 6 < args.length; j += 7) {
          const rx = args[j]!;
          const ry = args[j + 1]!;
          const xRot = args[j + 2]!;
          const largeArc = args[j + 3] !== 0;
          const sweep = args[j + 4] !== 0;
          const x = isRelative ? cursor.x + args[j + 5]! : args[j + 5]!;
          const y = isRelative ? cursor.y + args[j + 6]! : args[j + 6]!;
          // Delegate to the primitive arc → cubic converter. It splits
          // at π/16 (vs the legacy π/2 used here) — smoother
          // approximation matching the renderer's tessellation budget.
          const beziers = arcToCubicBeziers({
            x0: cursor.x, y0: cursor.y,
            rxIn: rx, ryIn: ry,
            rotationDeg: xRot,
            largeArc, sweep,
            x, y,
          });
          for (const c of beziers) {
            ensureStarted();
            bytes.push(CMD_CUBIC_TO);
            pushFloat32(bytes, c.x1);
            pushFloat32(bytes, c.y1);
            pushFloat32(bytes, c.x2);
            pushFloat32(bytes, c.y2);
            pushFloat32(bytes, c.x3);
            pushFloat32(bytes, c.y3);
            cursor.prevControlX = c.x2;
            cursor.prevControlY = c.y2;
            cursor.x = c.x3;
            cursor.y = c.y3;
          }
        }
        cursor.prevCmd = "A";
        break;
      }
      case "Z":
      case "z": {
        if (cursor.x !== cursor.startX || cursor.y !== cursor.startY) {
          ensureStarted();
          bytes.push(CMD_LINE_TO);
          pushFloat32(bytes, cursor.startX);
          pushFloat32(bytes, cursor.startY);
          cursor.x = cursor.startX;
          cursor.y = cursor.startY;
        }
        cursor.prevCmd = "Z";
        break;
      }
      default:
        break;
    }
  }
  bytes.push(0x00);
  return { bytes };
}

function pushFloat32(bytes: number[], value: number): void {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setFloat32(0, value, true);
  const view = new Uint8Array(buf);
  bytes.push(view[0]!, view[1]!, view[2]!, view[3]!);
}

type PathToken = {
  readonly cmd: string;
  readonly args: readonly number[];
};

function tokenizePathD(d: string): readonly PathToken[] {
  const tokens: PathToken[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(d)) !== null) {
    const cmd = match[1]!;
    const tail = match[2] ?? "";
    tokens.push({ cmd, args: parseNumbers(tail) });
  }
  return tokens;
}

function parseNumbers(input: string): readonly number[] {
  const out: number[] = [];
  const re = /-?(?:\d+\.\d*|\.?\d+)(?:[eE][+-]?\d+)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    const n = parseFloat(m[0]);
    if (Number.isFinite(n)) {
      out.push(n);
    }
  }
  return out;
}

