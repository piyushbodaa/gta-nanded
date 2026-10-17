"""Turn the OSM building snapshot into compact playable building data.

Every mapped building footprint in the bounds becomes one oriented box:
[x, z, width, depth, height, rotation, type] in game units (same projection
and 0.5 scale as build-city-data.py; heights stay in metres, matching the
illustrated buildings). Heights come from OSM height / building:levels tags
when present, else a per-type default with a deterministic per-building
variation. The world builder clearance-tests each footprint against roads,
the river and researched places before giving it a collider.

    python scripts/fetch-osm-buildings.py   # refreshes the snapshot (online)
    python scripts/build-buildings.py       # offline, reproducible
"""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCALE = 0.5
LAT, LON = 19.16, 77.31

TYPE_CODES = {
    'house': 0, 'residential': 0, 'detached': 0, 'semidetached_house': 0, 'terrace': 0, 'bungalow': 0, 'hut': 6,
    'apartments': 1, 'dormitory': 1, 'hotel': 1,
    'commercial': 2, 'retail': 2, 'office': 2, 'shop': 2, 'supermarket': 2, 'kiosk': 2,
    'industrial': 3, 'warehouse': 3, 'factory': 3, 'garage': 6, 'garages': 6, 'shed': 6, 'roof': 6, 'carport': 6,
    'school': 4, 'college': 4, 'university': 4, 'hospital': 4, 'public': 4, 'civic': 4, 'government': 4, 'kindergarten': 4,
    'church': 5, 'mosque': 5, 'temple': 5, 'chapel': 5, 'religious': 5, 'gurudwara': 5, 'shrine': 5,
}
DEFAULT_HEIGHTS = {0: 5.0, 1: 11.0, 2: 7.0, 3: 6.0, 4: 8.5, 5: 8.0, 6: 3.0, 7: 5.5}


def project(lat, lon):
    return ((lon - LON) * 111320 * math.cos(math.radians(LAT)) * SCALE,
            (LAT - lat) * 111320 * SCALE)


def hull(points):
    pts = sorted(set(points))
    if len(pts) < 3:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def oriented_box(points):
    """Minimum-area rectangle over the footprint hull, as (cx, cz, w, d, yaw)."""
    ring = hull(points)
    if len(ring) < 2:
        return None
    best = None
    edges = [(ring[(i + 1) % len(ring)][0] - ring[i][0], ring[(i + 1) % len(ring)][1] - ring[i][1]) for i in range(len(ring))]
    for ex, ez in edges:
        length = math.hypot(ex, ez)
        if length < 1e-9:
            continue
        ux, uz = ex / length, ez / length
        vx, vz = -uz, ux
        us = [x * ux + z * uz for x, z in points]
        vs = [x * vx + z * vz for x, z in points]
        w, d = max(us) - min(us), max(vs) - min(vs)
        area = w * d
        if best is None or area < best[0]:
            cu, cv = (max(us) + min(us)) / 2, (max(vs) + min(vs)) / 2
            centre = (cu * ux + cv * vx, cu * uz + cv * vz)
            # World yaw: local +x maps to (cos yaw, -sin yaw), so yaw aligns u.
            best = (area, centre, w, d, math.atan2(-uz, ux))
    if best is None:
        return None
    _, (cx, cz), w, d, yaw = best
    return cx, cz, w, d, yaw


def parse_height(tags, type_code, way_id):
    raw = str(tags.get('height', '')).replace('m', '').strip()
    try:
        metres = float(raw)
        if 2 <= metres <= 80:
            return metres
    except ValueError:
        pass
    try:
        levels = float(str(tags.get('building:levels', '')).strip())
        if 0 < levels <= 40:
            return levels * 3.1 + 0.8
    except ValueError:
        pass
    jitter = ((way_id * 2654435761) % 1000) / 1000  # deterministic 0..1
    return DEFAULT_HEIGHTS[type_code] * (0.82 + jitter * 0.4)


def geometry_points(element):
    if element['type'] == 'way':
        return [project(p['lat'], p['lon']) for p in element.get('geometry', [])]
    points = []
    for member in element.get('members', []):
        if member.get('role') in ('outer', '') and member.get('geometry'):
            points += [project(p['lat'], p['lon']) for p in member['geometry']]
    return points


def main():
    raw = json.loads((ROOT / 'research/osm-buildings.json').read_text())
    buildings, skipped = [], 0
    for element in raw['elements']:
        tags = element.get('tags', {})
        kind = str(tags.get('building', 'yes')).lower()
        if kind in ('no', 'construction', 'demolished', 'proposed'):
            skipped += 1
            continue
        points = geometry_points(element)
        box = oriented_box(points) if len(points) >= 3 else None
        if box is None:
            skipped += 1
            continue
        cx, cz, w, d, yaw = box
        if w < 1.1 or d < 1.1 or w * d < 1.6 or w * d > 6000:
            skipped += 1
            continue
        type_code = TYPE_CODES.get(kind, 7)
        if tags.get('amenity') == 'place_of_worship':
            type_code = 5
        height = max(2.6, min(42.0, parse_height(tags, type_code, int(element['id']))))
        buildings.append([round(cx, 2), round(cz, 2), round(w, 2), round(d, 2), round(height, 2), round(yaw, 3), type_code])
    buildings.sort(key=lambda b: (b[1], b[0]))
    payload = {'source': 'OpenStreetMap contributors', 'license': 'ODbL-1.0',
               'note': 'Footprints are mapped OSM buildings simplified to oriented boxes; heights are tagged or per-type defaults.',
               'count': len(buildings), 'buildings': buildings}
    for target in (ROOT / 'src/data/buildings.json', ROOT / 'public/data/buildings.json'):
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(payload, separators=(',', ':')))
    print(f'{len(buildings)} buildings written, {skipped} skipped (tiny, unbuilt or no geometry)')


if __name__ == '__main__':
    main()
