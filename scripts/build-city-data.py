"""Reproducible OSM street graph and explicitly sourced/approximate game places.

Input snapshots retain source tags. The playable graph is the largest connected
street component; disconnected service islands are not invented as connections.
Buildings are illustrative lots beside the map, not cadastral footprints.
"""
import json
import math
from collections import Counter, defaultdict, deque
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'src' / 'data'
OUT.mkdir(exist_ok=True)
SCALE = 0.5
LAT, LON = 19.16, 77.31
BBOX = (19.07, 77.24, 19.23, 77.425)


def project(lat, lon):
    return ((lon - LON) * 111320 * math.cos(math.radians(LAT)) * SCALE,
            (LAT - lat) * 111320 * SCALE)


def key(p):
    return (round(p['lat'], 7), round(p['lon'], 7))


def inside(p):
    return BBOX[0] <= p['lat'] <= BBOX[2] and BBOX[1] <= p['lon'] <= BBOX[3]


def dist_segment(p, a, b):
    dx, dz = b[0] - a[0], b[1] - a[1]
    t = max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz or 1)))
    q = (a[0] + t * dx, a[1] + t * dz)
    return math.dist(p, q), q, t


def simplify(points, tolerance=0.8):
    if len(points) < 3:
        return points
    a, b = project(*points[0]), project(*points[-1])
    distances = [dist_segment(project(*p), a, b)[0] for p in points[1:-1]]
    maximum = max(distances, default=0)
    if maximum <= tolerance:
        return [points[0], points[-1]]
    index = distances.index(maximum) + 1
    return simplify(points[:index + 1], tolerance)[:-1] + simplify(points[index:], tolerance)


elements = json.loads((ROOT / 'research/osm-network.json').read_text())['elements']
ways = [w for w in elements if w.get('tags', {}).get('highway')]
occurrences = Counter(key(p) for w in ways for p in w['geometry'] if inside(p))
node_index, nodes, edges = {}, [], []


def node(k):
    if k not in node_index:
        node_index[k] = len(nodes)
        x, z = project(*k)
        nodes.append({'x': round(x, 2), 'z': round(z, 2)})
    return node_index[k]


widths = {'trunk': 12, 'primary': 10, 'secondary': 9, 'tertiary': 8, 'unclassified': 6, 'residential': 4.8}
seen_edges = set()
for way in ways:
    tags = way['tags']
    kind = tags['highway']
    pieces, current = [], []
    for p in way['geometry']:
        if inside(p):
            current.append(key(p))
        elif current:
            pieces.append(current)
            current = []
    if current:
        pieces.append(current)
    for piece in pieces:
        # Preserve every shared junction while simplifying bends between them.
        cuts = [0] + [i for i in range(1, len(piece) - 1) if occurrences[piece[i]] > 1] + [len(piece) - 1]
        for start, end in zip(cuts, cuts[1:]):
            path = simplify(piece[start:end + 1])
            for ka, kb in zip(path, path[1:]):
                a, b = node(ka), node(kb)
                edge_key = tuple(sorted((a, b)))
                if a == b or edge_key in seen_edges:
                    continue
                seen_edges.add(edge_key)
                edges.append({'a': a, 'b': b, 'width': widths.get(kind.replace('_link', ''), 8),
                              'type': kind, 'name': tags.get('name', ''),
                              'bridge': tags.get('bridge') == 'yes'})

adj = defaultdict(list)
for e in edges:
    adj[e['a']].append(e['b'])
    adj[e['b']].append(e['a'])
remaining, components = set(range(len(nodes))), []
while remaining:
    todo = [remaining.pop()]
    component = set(todo)
    while todo:
        for n in adj[todo.pop()]:
            if n in remaining:
                remaining.remove(n)
                component.add(n)
                todo.append(n)
    components.append(component)
keep = max(components, key=len)
remap = {old: i for i, old in enumerate(sorted(keep))}
nodes = [nodes[old] for old in sorted(keep)]
edges = [{**e, 'a': remap[e['a']], 'b': remap[e['b']]} for e in edges if e['a'] in keep and e['b'] in keep]


def water_or_rails(field):
    result = []
    for way in elements:
        if not way.get('tags', {}).get(field):
            continue
        pieces, current = [], []
        for p in way.get('geometry', []):
            if inside(p):
                current.append(key(p))
            elif current:
                pieces.append(current)
                current = []
        if current:
            pieces.append(current)
        for piece in pieces:
            if len(piece) < 2:
                continue
            points = [{'x': round(project(*p)[0], 2), 'z': round(project(*p)[1], 2)} for p in simplify(piece, 2)]
            if field == 'waterway':
                name = way['tags'].get('name', 'Godavari')
                result.append({'name': name, 'width': 95 if 'Godavari' in name else 26, 'points': points})
            else:
                result.append(points)
    return result


network = {'nodes': nodes, 'edges': edges, 'rivers': water_or_rails('waterway'), 'rails': water_or_rails('railway'),
           'scale': SCALE, 'origin': {'lat': LAT, 'lon': LON}, 'bbox': BBOX,
           'source': 'https://www.openstreetmap.org/copyright', 'retrieved': '2026-10-16',
           'license': 'ODbL-1.0', 'omittedDisconnectedNodes': sum(len(c) for c in components) - len(keep)}
(OUT / 'network.json').write_text(json.dumps(network, ensure_ascii=False, separators=(',', ':')) + '\n')
(ROOT / 'public/data').mkdir(exist_ok=True)
(ROOT / 'public/data/network.json').write_text(json.dumps(network, ensure_ascii=False, separators=(',', ':')) + '\n')
print(f'Network: {len(nodes)} junction/bend nodes, {len(edges)} edges; {len(components)} source components')

overrides_path = ROOT / 'research/placement-overrides.json'
if not overrides_path.exists():
    print('Road network ready. Place generation waits for placement-overrides.json.')
    raise SystemExit(0)
overrides = json.loads(overrides_path.read_text())
if 'places' in overrides:
    overrides = overrides['places']
places = sum([json.loads((ROOT / f'research/{f}.json').read_text()) for f in ['education', 'landmarks', 'food-hotels']], [])
spawn_source = ROOT / 'research/spawn-location.json'
if spawn_source.exists():
    places.insert(0, json.loads(spawn_source.read_text()))

# Road-edge spatial index for frontage placement and clearance, all in game units.
grid = defaultdict(list)
CELL = 60
for i, e in enumerate(edges):
    a, b = nodes[e['a']], nodes[e['b']]
    margin = e['width'] / 2 + 35
    for gx in range(math.floor((min(a['x'], b['x']) - margin) / CELL), math.floor((max(a['x'], b['x']) + margin) / CELL) + 1):
        for gz in range(math.floor((min(a['z'], b['z']) - margin) / CELL), math.floor((max(a['z'], b['z']) + margin) / CELL) + 1):
            grid[gx, gz].append(i)


def nearest(p, count=14):
    ids = set()
    gx, gz = math.floor(p[0] / CELL), math.floor(p[1] / CELL)
    for radius in range(7):
        for xx in range(gx - radius, gx + radius + 1):
            for zz in range(gz - radius, gz + radius + 1):
                ids.update(grid.get((xx, zz), []))
        if len(ids) > count:
            break
    if not ids:
        ids = range(len(edges))
    candidates = []
    for i in ids:
        e = edges[i]
        a, b = nodes[e['a']], nodes[e['b']]
        distance, point, t = dist_segment(p, (a['x'], a['z']), (b['x'], b['z']))
        candidates.append((distance, i, point, t))
    return sorted(candidates)[:count]


occupied = []


def clear_lot(x, z, radius):
    for i in grid.get((math.floor(x / CELL), math.floor(z / CELL)), []):
        e = edges[i]
        a, b = nodes[e['a']], nodes[e['b']]
        if dist_segment((x, z), (a['x'], a['z']), (b['x'], b['z']))[0] < e['width'] / 2 + radius + 1.2:
            return False
    return all(math.hypot(x - bx, z - bz) > radius + br + 2 for bx, bz, br in occupied)


sizes = {'coaching': (11, 8, 17), 'college': (20, 13, 15), 'school': (17, 11, 12),
         'hotel': (12, 10, 17), 'restaurant': (10, 7, 7), 'cafe': (8, 7, 7),
         'cinema': (22, 15, 14), 'shopping': (20, 12, 12), 'landmark': (20, 16, 16),
         'transport': (22, 12, 9), 'hospital': (18, 13, 16), 'civic': (19, 13, 13),
         'junction': (8, 6, 7), 'park': (25, 22, 3)}
for place in places:
    override = overrides.get(place['id'], {})
    lat, lon = override.get('lat', place.get('lat')), override.get('lon', place.get('lon'))
    if lat is None or lon is None:
        raise ValueError(f"Missing researched area or pin: {place['id']}")
    place.update(override)
    if place['area'] == 'Vasarani':
        place['area'] = 'Vasarni'
    place['lat'], place['lon'] = lat, lon
    place.setdefault('locationPrecision', 'mapped' if not override and place.get('lat') else 'area')
    geo = project(lat, lon)
    place['geoX'], place['geoZ'] = round(geo[0], 2), round(geo[1], 2)
    w, d, h = sizes.get(place['category'], (12, 9, 12))
    if place['id'] == 'hazur-sahib':
        w, d, h = 32, 28, 23
    if place['id'] == 'nanded-airport':
        w, d, h = 36, 20, 12
    if place['id'] == 'sggs-stadium':
        w, d, h = 42, 35, 12
    if place['id'] == 'zenda-chowk':
        w, d, h = 14, 13, 7
    choice = None
    candidates = nearest(geo, 32)
    for shrink in [1, 0.8, 0.65]:
        ww, dd = w * shrink, d * shrink
        radius = math.hypot(ww, dd) / 2
        for offset in [0, 16, -16, 32, -32, 60, -60, 100, -100]:
            for _, ei, point, t in candidates:
                e = edges[ei]
                a, b = nodes[e['a']], nodes[e['b']]
                dx, dz = b['x'] - a['x'], b['z'] - a['z']
                length = math.hypot(dx, dz)
                if length < 1:
                    continue
                tx, tz = dx / length, dz / length
                tt = max(0.07, min(0.93, t + offset / length))
                px, pz = a['x'] + tt * dx, a['z'] + tt * dz
                preferred = 1 if (geo[0] - px) * (-tz) + (geo[1] - pz) * tx >= 0 else -1
                for side in [preferred, -preferred]:
                    nx, nz = -tz * side, tx * side
                    setback = e['width'] / 2 + radius + 2
                    bx, bz = px + nx * setback, pz + nz * setback
                    if not clear_lot(bx, bz, radius):
                        continue
                    choice = (bx, bz, math.atan2(-nx, -nz), ww, dd, h, px, pz, ei, radius)
                    break
                if choice:
                    break
            if choice:
                break
        if choice:
            break
    if not choice:
        raise ValueError(f"No road-clear frontage available for {place['id']}")
    bx, bz, rotation, w, d, h, px, pz, ei, radius = choice
    place.update(x=round(bx, 2), z=round(bz, 2), rotation=round(rotation, 5), w=round(w, 2), d=round(d, 2), h=h,
                 approach={'x': round(px, 2), 'z': round(pz, 2)}, roadEdge=ei,
                 frontageShiftMetres=round(math.hypot(bx - geo[0], bz - geo[1]) / SCALE))
    occupied.append((bx, bz, radius))

district_groups = defaultdict(list)
for p in places:
    district_groups[p['area']].append(p)
districts = []
for name, members in district_groups.items():
    districts.append({'name': name, 'x': round(sum(p['geoX'] for p in members) / len(members), 2),
                      'z': round(sum(p['geoZ'] for p in members) / len(members), 2)})
spawn_place = next((p for p in places if p['id'] == 'zenda-chowk'), next(p for p in places if p['id'] == 'bhagya-nagar-kaman'))
_, spawn_edge_id, spawn_point, _ = nearest((spawn_place['geoX'], spawn_place['geoZ']), 1)[0]
spawn_edge = edges[spawn_edge_id]
a, b = nodes[spawn_edge['a']], nodes[spawn_edge['b']]
spawn = {'x': round(spawn_point[0], 2), 'z': round(spawn_point[1], 2),
         'heading': math.atan2(-(b['x'] - a['x']), -(b['z'] - a['z'])),
         'placeId': spawn_place['id'], 'name': spawn_place['shortName'], 'area': spawn_place['area']}
bounds = {'minX': min(p['x'] for p in nodes) - 70, 'maxX': max(p['x'] for p in nodes) + 70,
          'minZ': min(p['z'] for p in nodes) - 70, 'maxZ': max(p['z'] for p in nodes) + 70}
city = {'places': places, 'districts': districts, 'bounds': bounds, 'spawn': spawn,
        'counts': dict(Counter(p['category'] for p in places)), 'researchedAt': '2026-10-16'}
(OUT / 'city.json').write_text(json.dumps(city, ensure_ascii=False, separators=(',', ':')) + '\n')
(ROOT / 'public/data').mkdir(exist_ok=True)
(ROOT / 'public/data/places.json').write_text(json.dumps(places, ensure_ascii=False, indent=2) + '\n')
print(f'Places: {len(places)}; mapped pins {sum(p["locationPrecision"] == "mapped" for p in places)}')
print('Category counts:', city['counts'])
print('Largest illustrated frontage shift:', max(p['frontageShiftMetres'] for p in places), 'real metres')
