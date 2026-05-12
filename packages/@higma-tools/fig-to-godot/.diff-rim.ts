import { readFileSync } from "node:fs";
import { PNG } from "pngjs";

const ref = PNG.sync.read(readFileSync("<REPO>/packages/@higma-tools/fig-to-godot/cases/decoration-combo/grad-blur/reference.png"));
const act = PNG.sync.read(readFileSync("<REPO>/packages/@higma-tools/fig-to-godot/cases/decoration-combo/grad-blur/actual.png"));

const cx = ref.width/2, cy = ref.height/2;
// Sample along the horizontal ray east from center, at the rim
console.log(`width ${ref.width} height ${ref.height}`);
console.log(`y=${cy}: x  ref(r,g,b,a)  act(r,g,b,a)  diff(r,g,b,a)`);
for (let x = 105; x < 145; x++) {
  const y = Math.floor(cy);
  const i = (y * ref.width + x) * 4;
  const r1 = ref.data[i], g1 = ref.data[i+1], b1 = ref.data[i+2], a1 = ref.data[i+3];
  const r2 = act.data[i], g2 = act.data[i+1], b2 = act.data[i+2], a2 = act.data[i+3];
  console.log(`x=${x} (dx=${x-cx})  ${r1},${g1},${b1},${a1}  ${r2},${g2},${b2},${a2}  d=${r2-r1},${g2-g1},${b2-b1},${a2-a1}`);
}
