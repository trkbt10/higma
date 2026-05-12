import { readFileSync } from "node:fs";
import { PNG } from "pngjs";

const ref = PNG.sync.read(readFileSync("<REPO>/packages/@higma-tools/fig-to-godot/cases/decoration-combo/grad-blur/reference.png"));
const act = PNG.sync.read(readFileSync("<REPO>/packages/@higma-tools/fig-to-godot/cases/decoration-combo/grad-blur/actual.png"));

// Spatial map: print average diff per radial band from center
const cx = ref.width/2, cy = ref.height/2;
const bandSize = 5;
const bands: { sum: number; max: number; count: number }[] = [];
for (let y = 0; y < ref.height; y++) {
  for (let x = 0; x < ref.width; x++) {
    const dx = x - cx, dy = y - cy;
    const dist = Math.sqrt(dx*dx + dy*dy);
    const band = Math.floor(dist / bandSize);
    while (bands.length <= band) bands.push({ sum: 0, max: 0, count: 0 });
    const i = (y * ref.width + x) * 4;
    const dr = Math.abs(act.data[i] - ref.data[i]);
    const dg = Math.abs(act.data[i+1] - ref.data[i+1]);
    const db = Math.abs(act.data[i+2] - ref.data[i+2]);
    const da = Math.abs(act.data[i+3] - ref.data[i+3]);
    const d = Math.max(dr, dg, db, da);
    bands[band].sum += d;
    bands[band].count += 1;
    bands[band].max = Math.max(bands[band].max, d);
  }
}
for (let i = 0; i < bands.length; i++) {
  const b = bands[i];
  const avg = b.sum / Math.max(1, b.count);
  console.log(`band r=${i*bandSize}..${(i+1)*bandSize}: count=${b.count}  avg=${avg.toFixed(2)}  max=${b.max}`);
}
