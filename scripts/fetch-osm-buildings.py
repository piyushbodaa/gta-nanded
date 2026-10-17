"""Fetch every OpenStreetMap building footprint inside the game bounds.

The public Overpass endpoint rejects city-sized queries when busy, so the
bounds are tiled small, each tile is retried with backoff, and progress is
checkpointed to research/osm-buildings.partial.json (safe to rerun — finished
tiles are skipped). The merged snapshot lands in research/osm-buildings.json
(ODbL, like the street snapshot); scripts/build-buildings.py turns it into
playable data offline afterwards:

    python scripts/fetch-osm-buildings.py
    python scripts/build-buildings.py
"""
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'research' / 'osm-buildings.json'
PARTIAL = ROOT / 'research' / 'osm-buildings.partial.json'
BBOX = (19.07, 77.24, 19.23, 77.425)  # south, west, north, east — matches build-city-data.py
COLS = ROWS = 8
ENDPOINT = 'https://overpass-api.de/api/interpreter'
HEADERS = {'User-Agent': 'GTA-Nanded/1.0 (open-source game; OSM building import)', 'Accept': 'application/json'}


def fetch_tile(south, west, north, east, tries=14):
    query = (f'[out:json][timeout:90];'
             f'(way[building]({south},{west},{north},{east});'
             f'relation[building]({south},{west},{north},{east}););out geom;')
    url = f'{ENDPOINT}?data={urllib.parse.quote(query)}'
    delay = 8
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=130) as reply:
                return json.load(reply).get('elements', [])
        except Exception as error:
            print(f'  tile ({south:.3f},{west:.3f}) attempt {attempt + 1} failed: {error}; waiting {delay}s', flush=True)
            time.sleep(delay)
            delay = min(delay * 2, 90)
    raise SystemExit(f'Overpass tile ({south},{west}) failed after {tries} tries — rerun to resume')


def main():
    south, west, north, east = BBOX
    done, seen = set(), {}
    if PARTIAL.exists():
        saved = json.loads(PARTIAL.read_text())
        done = set(saved['tiles'])
        seen = {(el['type'], el['id']): el for el in saved['elements']}
        print(f'resuming: {len(done)} tiles, {len(seen)} buildings already fetched', flush=True)
    for row in range(ROWS):
        for col in range(COLS):
            tile_id = f'{row}:{col}'
            if tile_id in done:
                continue
            s = south + (north - south) * row / ROWS
            n = south + (north - south) * (row + 1) / ROWS
            w = west + (east - west) * col / COLS
            e = west + (east - west) * (col + 1) / COLS
            elements = fetch_tile(round(s, 5), round(w, 5), round(n, 5), round(e, 5))
            for el in elements:
                seen[(el['type'], el['id'])] = el
            done.add(tile_id)
            PARTIAL.write_text(json.dumps({'tiles': sorted(done), 'elements': list(seen.values())}))
            print(f'tile {tile_id}: {len(elements)} elements, {len(seen)} unique, {len(done)}/{ROWS * COLS} tiles', flush=True)
            time.sleep(3)
    OUT.write_text(json.dumps({'bbox': BBOX, 'source': 'https://www.openstreetmap.org/copyright',
                                'license': 'ODbL-1.0', 'elements': list(seen.values())}))
    PARTIAL.unlink(missing_ok=True)
    print(f'wrote {OUT} with {len(seen)} buildings')


if __name__ == '__main__':
    main()
