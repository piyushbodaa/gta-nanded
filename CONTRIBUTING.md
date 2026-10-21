# Contributing to GTA Nanded

Thanks for helping build Nanded in the browser. Bug fixes, new missions, places, vehicles, performance work and better phone controls are all welcome.

## Get it running

You need Node.js 20.19+ or 22.12+ (Python 3 only to regenerate the city data).

```sh
git clone https://github.com/piyushbodaa/gta-nanded.git
cd gta-nanded
npm ci
npm run dev
```

Open the URL Vite prints. `dev.html` is a free-fly camera over the city (WASD, Q/E down/up, Shift fast, drag to look, T to run the clock) — handy for checking buildings and landmarks. In development, `gtaNanded.debugStart('free' | 'new')` in the console starts without the menu and `gtaNanded.simulate(seconds)` fast-forwards the game.

## Where things live

| Folder | What's in it |
| --- | --- |
| `src/world/` | road network, city generation, texture atlas, city shader, chunk streaming, landmarks, sky, water, colliders |
| `src/actors/` | people, vehicles (models, physics, rendering), traffic, pedestrians, the player |
| `src/game/` | the loop, camera, police, missions and story, side jobs, rules, effects, saves |
| `src/audio/` | synthesised sound effects, engines and the procedural radio |
| `src/ui/` | HUD, radar and city map, pause menu, touch controls, cover and intro styles |
| `scripts/` | data builds (`build-world.mjs`, `build-city-data.py`, `build-buildings.py`) |
| `research/` | sourced place records, OSM snapshots and notes |

## Before you open a pull request

```sh
npm test         # must pass
npm run build    # must build
```

Then play your change: on desktop, and in a phone-sized window in landscape (the touch UI appears on touch devices). Include a screenshot or short clip.

- Keep the frame cheap. The city is one draw call per chunk and everything that moves is instanced; new things should follow suit. Check the draw-call count in `dev.html`.
- Keep it working with keyboard only, touch only and with sound off.
- Add or update tests in `tests/` for logic (physics, routing, missions, police, saves).
- Match the surrounding code: small modules, readable names, comments that explain *why*.
- Data changes: edit `research/`, run `python scripts/build-city-data.py`, then `npm run world`, and commit the regenerated files.

## Content guidelines

- Art, audio and text must be original or under a licence that allows redistribution.
- Real places need a public source, like the records in `research/`. No private homes, real people's names or contact details.
- Stories are fictional satire with a light touch: no real people, no graphic violence, and respect around places of worship.
- Street data from OpenStreetMap stays under the ODbL (see `NOTICE`).

## Releases

Every pull request gets a Vercel preview; merging to `master` deploys gta.nanded.fun. The maintainer merges after playing the preview. By contributing you agree your contribution is MIT-licensed (see `LICENSE`).
