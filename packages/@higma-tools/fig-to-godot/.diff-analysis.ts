import { readFileSync } from "node:fs";
import { PNG } from "pngjs";

const ref = PNG.sync.read(readFileSync("<REPO>/packages/@higma-tools/fig-to-godot/cases/decoration-combo/grad-blur/reference.png"));
const act = PNG.sync.read(readFileSync("<REPO>/packages/@higma-tools/fig-to-godot/cases/decoration-combo/grad-blur/actual.png"));

console.log(`ref ${ref.width}x${ref.height} act ${act.width}x${act.height}`);
console.log(`channels ref=${ref.data.length/(ref.width*ref.height)} act=${act.data.length/(act.width*act.height)}`);

// Sample pixels: center, mid, edge
function sample(label: string, x: number, y: number) {
  const i = (y * ref.width + x) * 4;
  const j = (y * act.width + x) * 4;
  const r1 = ref.data[i], g1 = ref.data[i+1], b1 = ref.data[i+2], a1 = ref.data[i+3];
  const r2 = act.data[j], g2 = act.data[j+1], b2 = act.data[j+2], a2 = act.data[j+3];
  console.log(`${label} (${x},${y})  ref=${r1},${g1},${b1},${a1}  act=${r2},${g2},${b2},${a2}  d=${r2-r1},${g2-g1},${b2-b1},${a2-a1}`);
}

const cx = Math.floor(ref.width/2);
const cy = Math.floor(ref.height/2);
sample("center", cx, cy);
sample("c+5,5", cx+5, cy+5);
sample("c+20,20", cx+20, cy+20);
sample("c+40,40", cx+40, cy+40);
sample("c+60,0", cx+60, cy);
sample("near-edge", cx+80, cy);
sample("background", 5, 5);

// Histogram of diff magnitudes
const buckets: Record<string, number> = {};
let total = 0, bgMatch = 0;
for (let y = 0; y < ref.height; y++) {
  for (let x = 0; x < ref.width; x++) {
    const i = (y * ref.width + x) * 4;
    const dr = Math.abs(act.data[i] - ref.data[i]);
    const dg = Math.abs(act.data[i+1] - ref.data[i+1]);
    const db = Math.abs(act.data[i+2] - ref.data[i+2]);
    const da = Math.abs(act.data[i+3] - ref.data[i+3]);
    const dmax = Math.max(dr, dg, db, da);
    buckets[String(dmax)] = (buckets[String(dmax)] || 0) + 1;
    if (dmax === 0) bgMatch++;
    total++;
  }
}
console.log(`total ${total} bgMatch ${bgMatch}`);
const sorted = Object.entries(buckets).sort((a,b)=>Number(a[0])-Number(b[0]));
for (const [k,v] of sorted) console.log(`  diff=${k}: ${v} pixels`);
