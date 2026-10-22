# GTA NANDED

**उगं नव्हं मय, नांदेड हाय नांदेड!** — an open-world game of Nanded, Maharashtra, that runs in your browser at **[gta.nanded.fun](https://gta.nanded.fun)**.

Steal an auto-rickshaw outside Hazur Sahib Nanded station, weave through Shyam Nagar's coaching traffic, outrun Inspector Kadam's jeeps across the Godavari, and drive fares to real places across the city. The street map is the real one (OpenStreetMap); the 67,000 buildings, the traffic, the people, the sound and the music are all generated live in the browser.

## Play

| | Keyboard & mouse | Gamepad | Touch |
| --- | --- | --- | --- |
| Move / steer | `W A S D` / arrows | left stick | floating stick (left thumb) |
| Look | mouse (click to lock) · drag | right stick | drag the right half |
| Sprint · Jump · Punch | `Shift` · `Space` · click / `J` | X · A · B | RUN · JUMP · PUNCH |
| Get in / jack / get out | `F` (or `E`) | Y | ENTER / EXIT |
| Gas · Brake/reverse · Handbrake | `W` · `S` · `Space` | RT · LT · A | GAS · BRAKE · DRIFT |
| Horn · Radio · Look back | `H` · `R` · `C` | L3 · RB · — | HORN · 📻 |
| Buy / talk / photograph | `Q` | X | contextual button |
| Start a job (in an auto or on a two-wheeler) | `N` | — | START JOB |
| Map · Pause | `M` · `Esc` | Back · Start | MAP · ❚❚ |

**Story (8 missions).** Sunny "Bhau" Patil comes home from Pune. Pakya picks him up at the station in his auto; Anna at Workshop Corner always has "work"; Priya is late for her NEET mock test; Vicky Deshmukh, the neta's son with the white SUV, wants a race over the Govardhan Ghat bridge; Gurpreet Paaji needs flour at the langar before the evening sangat; and Inspector Kadam is closing in. Contacts appear on the radar and map with their initials — walk into a marker to start.

**Around town.**
- **Rickshaw fares** — in any auto press `N`: pick up people waving at the kerb and drive them to one of 133 researched real places. Fast, clean rides tip; streaks pay more.
- **Bhookh Express** — on any bike or scooty press `N`: collect from real restaurants, deliver while it's hot.
- **Street races** — *Nanded Circle* and *Station to Airport*, against rivals who play dirty.
- **Landmark passport** — photograph 17 landmarks (Hazur Sahib, the ghats, Nandgiri Fort, Kaleshwar, Vishnupuri Dam…) for stamps.
- **Roadside snacks** — chai, vada pav, misal at stalls and handcarts heal you and give you a burst of energy.
- **Anna's Rang Garage** — drive in while wanted: new colour, repairs, stars cleared (₹250).
- **Wanted level** — crimes the police see (or a witness reports) earn stars. Jeeps path-find to you and ram; officers get out with lathis. Break line of sight and leave the flashing search area on the radar to lose them, or end up **BUSTED** at Vazirabad Police Station. Get hurt too badly and it's **WASTED** — you wake up at SGGS Civil Hospital.
- **Radio** — three stations composed live: *Radio Godavari 92.7* (dhol-tasha), *Lavani Express 98.3* (dholki and harmonium), *Katta Lo-Fi 101.1*. Every song is new.
- **Neighbourhoods** — 53 of them; each first visit pays ₹50. A full day passes in about 20 real minutes, and the weather can be clear, hazy or monsoon.

Progress saves automatically on your device. Graphics adapt to your machine (Settings → Graphics to pin Fast / Balanced / High / Ultra).

## How it's built

Everything is plain JavaScript modules on [Three.js](https://threejs.org) with [Vite](https://vite.dev); there is no game engine, physics engine or texture file.

- **World data** — `scripts/build-world.mjs` folds the OSM street graph (26k segments) into 17,860 road polylines between 13,372 junctions, plus rivers, rail, 1,185 mapped building footprints and 133 researched places, into `public/data/world.json` (460 KB gzipped).
- **City generation** (`src/world/citygen.js`) — zones by neighbourhood (old city, coaching hub, markets, residential, Vishnupuri campus, outskirts), lots along every street and infill in block interiors, trees, poles and wires, stalls, shrines and hoardings. Deterministic: the same city on every device.
- **Rendering** — a procedural texture atlas painted on canvas at load (`src/world/atlas.js`: facades with grilles and chajjas, shopfronts, Marathi/English signboards, worn asphalt, kerbs) and one physically based shader for the whole city (`citymat.js`: glass that reflects the sky, sun-bleached grime, puddles in the monsoon, a world-space detail texture so repeats disappear), so each 192 m chunk is a single draw call; chunks stream around you. Trees are crowns of painted leaf cards that sway and cast dappled shadows (`foliage.js`). Landmarks are hand-built (`landmarks.js`), with gilded domes. Sky, sun, moon, clouds and weather in `sky.js`, which also captures the sky into a small cube map that lights and reflects everything; the Godavari in `water.js`. Every person and vehicle is instanced: ~50 draw calls for all of them.
- **Post-processing** (`post.js`) — the frame is drawn in high dynamic range, then gets distance haze that melts into the sky, reflections of the street in wet roads, bloom, a filmic curve and a colour grade that changes with the hour, vignette and grain.
- **Simulation** — a bicycle-model vehicle with tyre slip, weight transfer and a handbrake (`vehicle-physics.js`), impulse collisions against the city and between vehicles, lane-following traffic that keeps left and obeys signals at the big chowks (`traffic.js`), pedestrians who walk, dive, fall, flee or fight (`peds.js`), and police that hunt with A* routes and line-of-sight checks (`police.js`).
- **Game** — missions as small step scripts (`missions.js`, `story.js`), side jobs (`jobs.js`), consequences (`rules.js`), HUD and maps (`src/ui/`), and synthesised audio and music (`src/audio/`).

On an Intel Iris Xe laptop a typical street frame on High costs about 3 ms of CPU and 8 ms of GPU at 1576×863 with shadows, MSAA and bloom (~200 draw calls); Fast skips shadows, MSAA, bloom and wet reflections for phones.

## Develop

```sh
npm ci
npm run dev        # http://localhost:5173 — the game
                   # http://localhost:5173/dev.html — free-fly world viewer
npm test           # roads, city generation, physics, police, missions, saves
npm run build      # production build in dist/
npm run world      # rebuild public/data/world.json from src/data/ after data changes
```

`src/data/*.json` are generated from `research/` by `scripts/build-city-data.py` and `scripts/build-buildings.py` (Python 3). See [CONTRIBUTING.md](CONTRIBUTING.md).

## Sources, licences and disclaimers

**Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)** — the street network, rivers, rail and footprints in `public/data/world.json` and `src/data/`. Place research (addresses, coordinates, sources) lives in `research/` and [public/data/places.json](public/data/places.json); see [research/COVERAGE.md](research/COVERAGE.md).

Code, artwork and audio are [MIT](LICENSE) (see [NOTICE](NOTICE)). The cover art is original; fonts are Google Fonts (Anton, Barlow Condensed, DM Sans, Noto Sans Devanagari).

All characters, stories and businesses' roles in the story are fictional. Real places appear only as public settings; their inclusion implies no endorsement. The city is an illustration on the real street map, not a survey: distances are compressed to half scale and buildings are generated.
