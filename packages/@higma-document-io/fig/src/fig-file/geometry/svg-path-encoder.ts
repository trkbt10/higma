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
 * flattened to cubics via the W3C SVG implementation note algorithm).
 */

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
          const cp1x = (cursor.prevCmd === "C" || cursor.prevCmd === "S")
            ? cursor.x * 2 - cursor.prevControlX
            : cursor.x;
          const cp1y = (cursor.prevCmd === "C" || cursor.prevCmd === "S")
            ? cursor.y * 2 - cursor.prevControlY
            : cursor.y;
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
          const qx = (cursor.prevCmd === "Q" || cursor.prevCmd === "T")
            ? cursor.x * 2 - cursor.prevControlX
            : cursor.x;
          const qy = (cursor.prevCmd === "Q" || cursor.prevCmd === "T")
            ? cursor.y * 2 - cursor.prevControlY
            : cursor.y;
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
          const beziers = arcToCubics(cursor.x, cursor.y, rx, ry, xRot, largeArc, sweep, x, y);
          for (const c of beziers) {
            ensureStarted();
            bytes.push(CMD_CUBIC_TO);
            pushFloat32(bytes, c.cp1x);
            pushFloat32(bytes, c.cp1y);
            pushFloat32(bytes, c.cp2x);
            pushFloat32(bytes, c.cp2y);
            pushFloat32(bytes, c.x);
            pushFloat32(bytes, c.y);
            cursor.prevControlX = c.cp2x;
            cursor.prevControlY = c.cp2y;
            cursor.x = c.x;
            cursor.y = c.y;
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

type CubicSegment = {
  readonly cp1x: number; readonly cp1y: number;
  readonly cp2x: number; readonly cp2y: number;
  readonly x: number; readonly y: number;
};

function arcToCubics(
  x1: number, y1: number,
  rxIn: number, ryIn: number,
  xRotDeg: number,
  largeArc: boolean, sweep: boolean,
  x2: number, y2: number,
): readonly CubicSegment[] {
  if (rxIn === 0 || ryIn === 0) {
    return [{ cp1x: x1, cp1y: y1, cp2x: x2, cp2y: y2, x: x2, y: y2 }];
  }
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  const phi = (xRotDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const sqrtL = Math.sqrt(lambda);
    rx *= sqrtL;
    ry *= sqrtL;
  }
  const sign = largeArc === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const factor = sign * Math.sqrt(Math.max(0, num / den));
  const cxp = factor * (rx * y1p) / ry;
  const cyp = factor * -(ry * x1p) / rx;
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;
  const startAngle = angleBetween(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let deltaAngle = angleBetween(
    (x1p - cxp) / rx, (y1p - cyp) / ry,
    (-x1p - cxp) / rx, (-y1p - cyp) / ry,
  );
  if (!sweep && deltaAngle > 0) {
    deltaAngle -= 2 * Math.PI;
  } else if (sweep && deltaAngle < 0) {
    deltaAngle += 2 * Math.PI;
  }
  const segments = Math.max(1, Math.ceil(Math.abs(deltaAngle) / (Math.PI / 2)));
  const segmentAngle = deltaAngle / segments;
  const out: CubicSegment[] = [];
  for (let i = 0; i < segments; i += 1) {
    const a0 = startAngle + segmentAngle * i;
    const a1 = startAngle + segmentAngle * (i + 1);
    const t = (4 / 3) * Math.tan((a1 - a0) / 4);
    const cosA0 = Math.cos(a0); const sinA0 = Math.sin(a0);
    const cosA1 = Math.cos(a1); const sinA1 = Math.sin(a1);
    const cp1xp = rx * (cosA0 - t * sinA0);
    const cp1yp = ry * (sinA0 + t * cosA0);
    const cp2xp = rx * (cosA1 + t * sinA1);
    const cp2yp = ry * (sinA1 - t * cosA1);
    const xp = rx * cosA1;
    const yp = ry * sinA1;
    const cp1x = cosPhi * cp1xp - sinPhi * cp1yp + cx;
    const cp1y = sinPhi * cp1xp + cosPhi * cp1yp + cy;
    const cp2x = cosPhi * cp2xp - sinPhi * cp2yp + cx;
    const cp2y = sinPhi * cp2xp + cosPhi * cp2yp + cy;
    const x = cosPhi * xp - sinPhi * yp + cx;
    const y = sinPhi * xp + cosPhi * yp + cy;
    out.push({ cp1x, cp1y, cp2x, cp2y, x, y });
  }
  return out;
}

function angleBetween(ux: number, uy: number, vx: number, vy: number): number {
  const dot = ux * vx + uy * vy;
  const len = Math.sqrt(ux * ux + uy * uy) * Math.sqrt(vx * vx + vy * vy);
  let theta = Math.acos(Math.min(1, Math.max(-1, dot / len)));
  if (ux * vy - uy * vx < 0) {
    theta = -theta;
  }
  return theta;
}
