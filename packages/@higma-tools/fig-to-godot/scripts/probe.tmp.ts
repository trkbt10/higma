import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
const arg = process.argv[2] ?? "decoration-combo/grad-radius-pill";
const ref = PNG.sync.read(await readFile(fileURLToPath(new URL(`../cases/${arg}/reference.png`, import.meta.url))));
const act = PNG.sync.read(await readFile(fileURLToPath(new URL(`../cases/${arg}/actual.png`, import.meta.url))));
console.log(`Image: ${ref.width}x${ref.height}`);
const samples: Array<[number, number, string]> = [
  [40, 30, "TL inside"],
  [80, 30, "T mid"],
  [120, 30, "TR inside"],
  [80, 40, "centre top half"],
  [60, 40, "centre left half"],
  [100, 40, "centre right half"],
];
for (const [x, y, label] of samples) {
  const i = (y * ref.width + x) * 4;
  if (x >= ref.width || y >= ref.height) continue;
  console.log(`  ${label.padEnd(20)} (${x},${y}): ref=(${ref.data[i]},${ref.data[i+1]},${ref.data[i+2]}) act=(${act.data[i]},${act.data[i+1]},${act.data[i+2]})`);
}
// Find first diff pixel
let count = 0;
console.log("\nFirst diff pixels:");
for (let y = 0; y < ref.height && count < 10; y++) {
  for (let x = 0; x < ref.width && count < 10; x++) {
    const i = (y * ref.width + x) * 4;
    if (ref.data[i] !== act.data[i] || ref.data[i+1] !== act.data[i+1] || ref.data[i+2] !== act.data[i+2]) {
      console.log(`  (${x},${y}): ref=(${ref.data[i]},${ref.data[i+1]},${ref.data[i+2]}) act=(${act.data[i]},${act.data[i+1]},${act.data[i+2]})`);
      count++;
    }
  }
}
