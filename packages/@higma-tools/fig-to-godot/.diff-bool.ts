import { readFileSync } from "node:fs";
import { PNG } from "pngjs";

const ref = PNG.sync.read(readFileSync("<REPO>/packages/@higma-tools/fig-to-godot/cases/boolean/bool-opacity/reference.png"));
const act = PNG.sync.read(readFileSync("<REPO>/packages/@higma-tools/fig-to-godot/cases/boolean/bool-opacity/actual.png"));

console.log(`size ${ref.width}x${ref.height}`);

// Sample inside the gray boolean shape
function sample(label: string, x: number, y: number) {
  const i = (y * ref.width + x) * 4;
  const j = (y * act.width + x) * 4;
  console.log(`${label} (${x},${y}) ref=${ref.data[i]},${ref.data[i+1]},${ref.data[i+2]},${ref.data[i+3]} act=${act.data[j]},${act.data[j+1]},${act.data[j+2]},${act.data[j+3]} d=${act.data[j]-ref.data[i]},${act.data[j+1]-ref.data[i+1]},${act.data[j+2]-ref.data[i+2]}`);
}

sample("inside gray", 50, 50);
sample("inside gray-2", 80, 60);
sample("yellow bg", 10, 10);
sample("yellow bg-edge", 130, 50);
sample("middle bool", 70, 80);

// Histogram of diff types
let inGray=0, inYellow=0, mixed=0;
const grayPix: number[][] = [];
const yellowPix: number[][] = [];
for (let y = 0; y < ref.height; y++) {
  for (let x = 0; x < ref.width; x++) {
    const i = (y * ref.width + x) * 4;
    const r1 = ref.data[i], g1 = ref.data[i+1], b1 = ref.data[i+2];
    const r2 = act.data[i], g2 = act.data[i+1], b2 = act.data[i+2];
    const dr = r2 - r1, dg = g2 - g1, db = b2 - b1;
    if (dr === 0 && dg === 0 && db === 0) continue;
    if (r1 > 200 && g1 > 200 && b1 < 100) { yellowPix.push([dr, dg, db]); }
    else if (r1 > 100 && r1 < 200 && g1 > 100 && g1 < 200 && b1 > 100 && b1 < 200) { grayPix.push([dr, dg, db]); }
    else { mixed++; }
  }
}
console.log(`gray pixels: ${grayPix.length}, yellow: ${yellowPix.length}, mixed: ${mixed}`);
if (grayPix.length > 0) {
  const avg = grayPix.reduce((a, p) => [a[0]+p[0], a[1]+p[1], a[2]+p[2]], [0,0,0]).map(v => (v/grayPix.length).toFixed(2));
  console.log(`gray avg diff: ${avg.join(",")}`);
  console.log(`gray sample diffs: ${grayPix.slice(0,5).map(p => p.join(",")).join(" | ")}`);
}
if (yellowPix.length > 0) {
  const avg = yellowPix.reduce((a, p) => [a[0]+p[0], a[1]+p[1], a[2]+p[2]], [0,0,0]).map(v => (v/yellowPix.length).toFixed(2));
  console.log(`yellow avg diff: ${avg.join(",")}`);
  console.log(`yellow sample diffs: ${yellowPix.slice(0,5).map(p => p.join(",")).join(" | ")}`);
}
