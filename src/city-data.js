import network from './data/network.json' with { type: 'json' };
import city from './data/city.json' with { type: 'json' };
import buildings from './data/buildings.json' with { type: 'json' };

export const NETWORK = network;
// Every OSM-mapped building footprint in the bounds, as oriented boxes:
// [x, z, width, depth, height, rotation, type]. See scripts/build-buildings.py.
export const BUILDINGS = buildings.buildings || [];
export const PLACES = city.places;
export const DISTRICTS = city.districts;
export const BOUNDS = city.bounds;
export const SPAWN = city.spawn;
export const PLACE_COUNTS = city.counts;
export const PLACE_BY_ID = new Map(PLACES.map(place => [place.id, place]));
