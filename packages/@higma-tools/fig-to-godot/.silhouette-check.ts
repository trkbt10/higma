// Generate a binary silhouette for the grad-blur ellipse (100x100)
// and verify shape boundaries.
const w = 100, h = 100;
const cx = w/2, cy = h/2;
const rx = w/2, ry = h/2;
const segments = 64;
const verts: { x: number; y: number }[] = new Array(segments);
for (let i = 0; i < segments; i++) {
  const a = (2 * Math.PI * i) / segments;
  verts[i] = { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
}
// Print first/last few verts
console.log("first vert:", verts[0]);
console.log("vert at index 16 (top):", verts[16]);
console.log("vert at index 32 (left):", verts[32]);

// Check rim pixels along horizontal at y=50 (middle row), x from 0..50
console.log("Horizontal scan at y=50.5 (px=49.5 to 50.5):");
const py = 50.5;
for (let x = 95; x < 105; x++) {
  const px = x + 0.5;
  let inside = false;
  for (let i = 0, j = segments - 1; i < segments; j = i, i++) {
    const vi = verts[i]!;
    const vj = verts[j]!;
    if ((vi.y > py) !== (vj.y > py)) {
      const intersectX = (vj.x - vi.x) * (py - vi.y) / (vj.y - vi.y) + vi.x;
      if (px < intersectX) {
        inside = !inside;
      }
    }
  }
  console.log(`  x=${x} px=${px}: inside=${inside}`);
}
