import network from './data/network.json' with { type: 'json' };
import city from './data/city.json' with { type: 'json' };

export const NETWORK = network;
export const PLACES = city.places;
export const DISTRICTS = city.districts;
export const BOUNDS = city.bounds;
export const SPAWN = city.spawn;
export const PLACE_COUNTS = city.counts;
export const PLACE_BY_ID = new Map(PLACES.map(place => [place.id, place]));
