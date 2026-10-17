/**
 * A spatial index of the street network, so animals can be kept off the carriageway.
 * Each street is a straight segment between two nodes; a point is "on the road" when it is
 * within half the street's width (plus a small margin) of any segment.
 */
export function buildRoadIndex(nodes, edges, scale = 1, cell = 30, margin = 1) {
  const grid = new Map();
  const key = (cx, cz) => `${cx},${cz}`;
  edges.forEach((edge, index) => {
    const a = nodes[edge.a], b = nodes[edge.b];
    if (!a || !b) return;
    const reach = (edge.width || 6) * scale / 2 + margin;
    const minX = Math.min(a.x, b.x) - reach, maxX = Math.max(a.x, b.x) + reach;
    const minZ = Math.min(a.z, b.z) - reach, maxZ = Math.max(a.z, b.z) + reach;
    for (let cx = Math.floor(minX / cell); cx <= Math.floor(maxX / cell); cx++) {
      for (let cz = Math.floor(minZ / cell); cz <= Math.floor(maxZ / cell); cz++) {
        const k = key(cx, cz);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, reach });
      }
    }
  });
  function segmentDistance(px, pz, s) {
    const dx = s.bx - s.ax, dz = s.bz - s.az;
    const len2 = dx * dx + dz * dz;
    const t = len2 ? Math.max(0, Math.min(1, ((px - s.ax) * dx + (pz - s.az) * dz) / len2)) : 0;
    return Math.hypot(px - (s.ax + dx * t), pz - (s.az + dz * t));
  }
  return {
    /** True when (x, z) lies on or next to a street. */
    onRoad(x, z) {
      const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        for (const s of grid.get(key(cx + i, cz + j)) || []) {
          if (segmentDistance(x, z, s) <= s.reach) return true;
        }
      }
      return false;
    },
  };
}
