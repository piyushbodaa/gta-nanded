// Loads the city data and assembles every static system of the world:
// streets, generated city, textures, chunk streaming, sky and rivers.
import * as THREE from 'three';
import { RoadNet } from './roadnet.js';
import { City } from './citygen.js';
import { loadAtlasFonts, paintAtlas, paintSigns } from './atlas.js';
import { createAtlasTextures, createCityMaterials, cityUniforms } from './citymat.js';
import { ChunkManager } from './chunks.js';
import { Sky } from './sky.js';
import { createRivers } from './water.js';
import { Colliders } from './colliders.js';

const tick = () => new Promise(r => setTimeout(r, 0));

export async function loadWorldData(onProgress) {
  const res = await fetch('/data/world.json');
  if (!res.ok) throw new Error(`World data failed to load (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) return res.json();
  const reader = res.body.getReader();
  const parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); got += value.length;
    onProgress?.(Math.min(1, got / total));
  }
  const all = new Uint8Array(got);
  let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
  return JSON.parse(new TextDecoder().decode(all));
}

/**
 * Build the world. stage(label, fraction) reports progress for the loading screen.
 */
export async function createWorld(scene, renderer, { stage = () => {}, focus } = {}) {
  stage('Fetching the streets of Nanded', 0.02);
  const data = await loadWorldData(f => stage('Fetching the streets of Nanded', 0.02 + f * 0.18));
  await tick();
  stage('Laying out the roads', 0.22);
  const net = new RoadNet(data);
  await tick();
  stage('Building the neighbourhoods', 0.28);
  const city = new City(data, net);
  city.generate();
  await tick();
  stage('Painting shopfronts and signboards', 0.48);
  await loadAtlasFonts();
  // Phones get half-resolution atlases: a quarter of the texture memory.
  const small = matchMedia('(any-pointer: coarse)').matches && Math.min(screen.width, screen.height) < 900;
  const atlas = paintAtlas(small ? 0.5 : 1);
  const signs = paintSigns(data.places, small ? 0.5 : 1);
  const textures = createAtlasTextures(atlas, signs, renderer);
  const materials = createCityMaterials(textures);
  await tick();
  stage('Mapping walls and kerbs', 0.6);
  const colliders = new Colliders(city);
  await tick();
  const sky = new Sky(scene, renderer);
  const rivers = createRivers(scene, city, sky);
  const chunks = new ChunkManager(scene, city, materials, signs.slots);
  if (focus) {
    stage('Raising the city', 0.66);
    await tick();
    chunks.prime(focus.x, focus.z, 300, f => stage('Raising the city', 0.66 + f * 0.3));
  }
  stage('The city is yours', 1);
  return { data, net, city, colliders, sky, rivers, chunks, materials, textures, cityUniforms };
}
