// The street graph as it travels: world.json is mostly road coordinates, and written out as
// decimal metres they are most of the download. pack() stores the same numbers losslessly in
// far fewer characters; unpack() gives back exactly what scripts/build-world.mjs assembled.
//
//   - Coordinates are whole decimetres (the build already rounds to 0.1 m), each one written
//     as the step from the point before it, so a street is a run of small integers.
//   - A road begins and ends on its junctions, so only the points in between are stored.
//   - Which roads meet at a junction follows from the roads' own ends, so it is not stored.
//   - Road fields are kept in columns (all the widths together, all the types together...).
const dm = v => Math.round(v * 10);

/** The junction lists the build writes: each road, in order, added to junction a and then to b. */
function junctionRoads(count, a, b) {
  const lists = Array.from({ length: count }, () => []);
  for (let i = 0; i < a.length; i++) { lists[a[i]].push(i); if (b[i] !== a[i]) lists[b[i]].push(i); }
  return lists;
}

export function pack(world) {
  const { junctions, roads, ...rest } = world;
  const J = [];
  let px = 0, pz = 0;
  for (const [x, z] of junctions) { J.push(dm(x) - px, dm(z) - pz); px = dm(x); pz = dm(z); }
  const R = { a: [], b: [], w: [], t: [], n: [], br: [], k: [], p: [] };
  for (const [a, b, w, t, n, br, ...p] of roads) {
    const end = p.length - 2;
    if (p[0] !== junctions[a][0] || p[1] !== junctions[a][1] || p[end] !== junctions[b][0] || p[end + 1] !== junctions[b][1]) {
      throw new Error('A road does not start and end on its junctions: the packed format cannot hold it.');
    }
    R.a.push(a); R.b.push(b); R.w.push(w); R.t.push(t); R.n.push(n); R.br.push(br); R.k.push(end / 2 - 1);
    let x = dm(p[0]), z = dm(p[1]);
    for (let i = 2; i < end; i += 2) { R.p.push(dm(p[i]) - x, dm(p[i + 1]) - z); x = dm(p[i]); z = dm(p[i + 1]); }
  }
  const lists = junctionRoads(junctions.length, R.a, R.b);
  junctions.forEach((j, i) => {
    const own = j.slice(2);
    if (own.length !== lists[i].length || own.some((r, k) => r !== lists[i][k])) throw new Error('A junction lists roads in an order the packed format cannot rebuild.');
  });
  return { ...rest, packed: 1, junctions: J, roads: R };
}

/** World data as the game reads it. Data that was never packed passes straight through. */
export function unpack(data) {
  if (!data.packed) return data;
  const { packed, junctions: J, roads: R, ...rest } = data;
  const count = J.length / 2, lists = junctionRoads(count, R.a, R.b);
  const jx = new Array(count), jz = new Array(count), junctions = new Array(count);
  let x = 0, z = 0;
  for (let i = 0; i < count; i++) {
    x += J[2 * i]; z += J[2 * i + 1]; jx[i] = x; jz[i] = z;
    junctions[i] = [x / 10, z / 10, ...lists[i]];
  }
  const roads = new Array(R.a.length);
  let o = 0;
  for (let i = 0; i < roads.length; i++) {
    const a = R.a[i], b = R.b[i], road = [a, b, R.w[i], R.t[i], R.n[i], R.br[i], jx[a] / 10, jz[a] / 10];
    x = jx[a]; z = jz[a];
    for (let k = 0; k < R.k[i]; k++) { x += R.p[o++]; z += R.p[o++]; road.push(x / 10, z / 10); }
    road.push(jx[b] / 10, jz[b] / 10);
    roads[i] = road;
  }
  return { ...rest, junctions, roads };
}
