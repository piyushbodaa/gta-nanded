// Converts the checked-in city snapshots into the compact runtime world file.
//
//   node scripts/build-world.mjs
//
// Input:  src/data/network.json (OSM street graph, 0.5 scale), src/data/city.json
//         (researched places), src/data/buildings.json (OSM footprints).
// Output: public/data/world.json, fetched by the game at startup.
//
// The OSM graph stores one edge per mapped segment. The game wants roads: one
// polyline per stretch between junctions, so lanes, meshes and AI can follow a
// street without re-walking the graph. Degree-2 nodes are folded into the
// polylines; a stretch also breaks where its width, class, bridge flag or
// one-way direction changes. One-way roads (each carriageway of a dual
// carriageway, roundabouts) keep their direction of travel.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => JSON.parse(readFileSync(join(root, file), 'utf8'));
const network = read('src/data/network.json');
const city = read('src/data/city.json');
const buildings = read('src/data/buildings.json');

const TYPES = ['trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential'];
const typeIndex = type => {
  const base = type.replace('_link', '');
  const i = TYPES.indexOf(base);
  return i < 0 ? TYPES.length - 1 : i;
};
const q = v => Math.round(v * 10) / 10;

// --- 1. Clean graph: merge duplicate nodes, drop zero-length and duplicate edges.
const nodes = network.nodes.map(n => ({ x: q(n.x), z: q(n.z) }));
const key = n => `${n.x},${n.z}`;
const canonical = new Map();
const remap = nodes.map((n, i) => {
  const k = key(n);
  if (!canonical.has(k)) canonical.set(k, i);
  return canonical.get(k);
});
const edgeSeen = new Set();
const edges = [];
for (const e of network.edges) {
  const a = remap[e.a], b = remap[e.b];
  if (a === b) continue;
  const k = a < b ? `${a}-${b}` : `${b}-${a}`;
  if (edgeSeen.has(k)) continue;
  edgeSeen.add(k);
  edges.push({ a, b, width: e.width, type: typeIndex(e.type), name: e.name || '', bridge: Boolean(e.bridge), oneway: e.oneway || 0 });
}

// --- 2. Keep the largest connected component so every road is reachable.
const adj = new Map();
const link = (n, ei) => { if (!adj.has(n)) adj.set(n, []); adj.get(n).push(ei); };
edges.forEach((e, i) => { link(e.a, i); link(e.b, i); });
const component = new Map();
let best = -1, bestSize = 0, comp = 0;
for (const start of adj.keys()) {
  if (component.has(start)) continue;
  let size = 0;
  const stack = [start];
  component.set(start, comp);
  while (stack.length) {
    const n = stack.pop(); size++;
    for (const ei of adj.get(n)) {
      const e = edges[ei], m = e.a === n ? e.b : e.a;
      if (!component.has(m)) { component.set(m, comp); stack.push(m); }
    }
  }
  if (size > bestSize) { bestSize = size; best = comp; }
  comp++;
}
const liveEdges = edges.filter(e => component.get(e.a) === best);
const liveAdj = new Map();
liveEdges.forEach((e, i) => {
  for (const n of [e.a, e.b]) { if (!liveAdj.has(n)) liveAdj.set(n, []); liveAdj.get(n).push(i); }
});

// --- 3. Fold degree-2 chains into roads between junctions.
const sameRoad = (e, f) => e.width === f.width && e.type === f.type && e.bridge === f.bridge && e.name === f.name;
// Traffic on edge e at its end n: 1 flows only into n, -1 only out of n, 0 both ways.
const flowAt = (e, n) => (e.oneway ? ((e.oneway > 0) === (e.b === n) ? 1 : -1) : 0);
const isJunction = n => {
  const list = liveAdj.get(n);
  if (list.length !== 2) return true;
  const e = liveEdges[list[0]], f = liveEdges[list[1]];
  // A road runs on through n only if what flows in on one side flows out on the other.
  return !sameRoad(e, f) || flowAt(e, n) !== -flowAt(f, n);
};
const used = new Uint8Array(liveEdges.length);
const junctionId = new Map();
const junctions = [];
const junctionFor = n => {
  if (!junctionId.has(n)) { junctionId.set(n, junctions.length); junctions.push({ x: nodes[n].x, z: nodes[n].z, roads: [] }); }
  return junctionId.get(n);
};
const names = [''];
const nameIndex = new Map([['', 0]]);
const nameOf = name => { if (!nameIndex.has(name)) { nameIndex.set(name, names.length); names.push(name); } return nameIndex.get(name); };
const roads = [];

function walk(startNode, firstEdge) {
  const pts = [startNode];
  let n = startNode, ei = firstEdge;
  const template = liveEdges[firstEdge];
  for (;;) {
    used[ei] = 1;
    const e = liveEdges[ei];
    const next = e.a === n ? e.b : e.a;
    pts.push(next);
    n = next;
    if (isJunction(n) || n === startNode) break;
    const list = liveAdj.get(n);
    const nextEdge = list[0] === ei ? list[1] : list[0];
    if (used[nextEdge]) break;
    ei = nextEdge;
  }
  return { pts, template };
}

function addRoad(pts, template) {
  if (pts.length < 2) return;
  const a = junctionFor(pts[0]), b = junctionFor(pts[pts.length - 1]);
  const flat = [];
  for (const p of pts) flat.push(nodes[p].x, nodes[p].z);
  const id = roads.length;
  // Direction of a one-way road in its own a -> b terms: 1 when traffic leaves pts[0].
  const ow = template.oneway ? -flowAt(template, pts[0]) : 0;
  roads.push({ a, b, w: template.width, t: template.type, n: nameOf(template.name), br: template.bridge ? 1 : 0, ow, p: flat });
  junctions[a].roads.push(id);
  if (b !== a) junctions[b].roads.push(id);
}

for (const n of liveAdj.keys()) {
  if (!isJunction(n)) continue;
  for (const ei of liveAdj.get(n)) {
    if (used[ei]) continue;
    const { pts, template } = walk(n, ei);
    addRoad(pts, template);
  }
}
// Pure loops with no junction at all.
for (let i = 0; i < liveEdges.length; i++) {
  if (used[i]) continue;
  const { pts, template } = walk(liveEdges[i].a, i);
  addRoad(pts, template);
}

// --- 4. Places: keep what the game uses at runtime; the full catalog stays in public/data/places.json.
const places = city.places.map(p => ({
  id: p.id, name: p.name, shortName: p.shortName, category: p.category, area: p.area,
  x: q(p.x), z: q(p.z), rot: Math.round((p.rotation || 0) * 1000) / 1000,
  w: p.w, d: p.d, h: p.h,
  ax: q(p.approach.x), az: q(p.approach.z),
  aliases: p.aliases || [], detail: p.localDetail || '', address: p.address || '',
  source: p.sourceUrl || '', sourceTitle: p.sourceTitle || '', precision: p.locationPrecision || '',
}));

const world = {
  version: 2,
  scale: network.scale,
  origin: network.origin,
  bounds: city.bounds,
  license: 'Street data © OpenStreetMap contributors, ODbL-1.0. Places: see research/ and public/data/places.json.',
  types: TYPES,
  names,
  junctions: junctions.map(j => [j.x, j.z, ...j.roads]),
  roads: roads.map(r => [r.a, r.b, r.w, r.t, r.n, r.br, ...r.p]),
  // One-way roads by index: traffic goes only from junction a to b (forward) or b to a (backward).
  oneway: { forward: roads.flatMap((r, i) => (r.ow > 0 ? [i] : [])), backward: roads.flatMap((r, i) => (r.ow < 0 ? [i] : [])) },
  rivers: network.rivers.map(r => ({ name: r.name, w: r.width, p: r.points.flatMap(p => [q(p.x), q(p.z)]) })),
  rails: network.rails.map(line => line.flatMap(p => [q(p.x), q(p.z)])),
  places,
  districts: city.districts.map(d => [d.name, q(d.x), q(d.z)]),
  spawn: city.spawn,
  footprints: buildings.buildings.map(b => b.map((v, i) => (i < 5 ? q(v) : i === 5 ? Math.round(v * 1000) / 1000 : v))),
};

mkdirSync(join(root, 'public/data'), { recursive: true });
const out = JSON.stringify(world);
writeFileSync(join(root, 'public/data/world.json'), out);
const degree = new Map();
for (const j of junctions) degree.set(j.roads.length, (degree.get(j.roads.length) || 0) + 1);
console.log(`world.json: ${(out.length / 1024).toFixed(0)} KB · ${roads.length} roads · ${junctions.length} junctions · ` +
  `${liveEdges.length}/${edges.length} edges kept · degrees ${JSON.stringify([...degree].sort((a, b) => a[0] - b[0]))} · ` +
  `${world.oneway.forward.length + world.oneway.backward.length} one-way · ${places.length} places · ${world.footprints.length} footprints`);
