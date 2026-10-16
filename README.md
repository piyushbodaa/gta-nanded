# GTA NANDED

An original, single-player 3D browser driving game built for **gta.nanded.fun**, set in Nanded, Maharashtra. Explore **129 researched places** along compressed OpenStreetMap streets, take **12 repeatable jobs**, or find familiar coaching lanes, campuses, cafés and riverfront stops at your own pace.

The playable vehicles, characters, building illustrations, signage and synthesized audio are made in code. The opening animates original comic artwork in the browser with a newly composed soundtrack. The street network comes from real map data; the game buildings are original illustrations.

## Play

- **WASD / arrow keys:** drive or walk; walking follows the direction of the camera
- **Drag the street / swipe the screen:** look around and tilt the camera
- **C / Center camera button:** return the camera behind your character or vehicle
- **E:** enter or exit a nearby vehicle; slow down before exiting
- **Space:** handbrake
- **Shift:** boost or sprint
- **H:** horn; enable sound first
- **M:** open the city guide and map; clicking the minimap also opens it
- **Escape:** pause or resume
- **R:** recover and repair your vehicle, costing up to ₹100 of in-game earnings
- **N:** accept the next job or retry after completion/failure

Touch devices have direction, brake, boost, enter/exit and map buttons. Hold a driving button with one finger and drag the open street with another to look around. Looking around holds its angle while stopped; driving recenters the view after two seconds without a drag. The camera moves closer when a wall or roof would block the character. Both maps stay north-up, and their player arrows show character/vehicle facing. The GPS-card arrow points toward the destination relative to your camera. The mobile minimap starts hidden behind **Mini map**, and street-job details start collapsed; tap the job's chevron to expand them. Use the Controls button to pause. Portrait mode shows a dismissible rotation hint. **Wide view** requests fullscreen and landscape orientation where supported; otherwise, turn the phone sideways. A modern WebGL2-capable browser is required.

Start with **Story Drive** to drive or **Free Roam** to walk. The original **12-second animated comic opening** can be skipped immediately or replayed with **Replay Intro**. Sound starts off; the opening's sound button keeps your choice for later replays on the same page. If the browser blocks sound, the sequence continues silently. Reduced-motion preferences, unavailable animation or failed artwork loading use a still opening with a continue button. Switching to another tab pauses the sequence and its music until you return.

The entrance and opening feature **“उगं नव्हं मय, नांदेड हाय नांदेड!”**, with Marathi welcome messages and fictional local dialogue in coaching, chai, station and reunion jobs.

Your run begins beside the public **Zenda Chowk (झेंडा चौक)** in **Taroda Khurd**, near Chhatrapati Chowk. The starting lane includes a grey-blue home with yellow accents, a striped metal gate and greenery inspired by supplied visual references. It is an illustrative setting, not a claim to identify or locate a private residence.

Open the city guide to search names, aliases and neighborhoods, filter categories, or find places still to discover. Select **Set destination** for a street-following GPS route, or **Go there · free** for instant travel. Both actions switch to free roam without a job timer. Choose **Take a street job** when ready to resume jobs.

For delivery jobs, enter the amber ring in a vehicle and slow below 36 km/h. Race checkpoints can be taken at speed. Collisions and taking occupied traffic vehicles attract police; evade patrols to lose your wanted level. Jobs and fines use fictional in-game rupees, never real money.

## Included

- 129 places across 53 locality labels: coaching institutes, colleges, schools, landmarks, junctions, transport stops, hospitals, civic buildings, a park, hotels, restaurants, cafés, cinemas and shopping places.
- Hazur Sahib and the riverfront gurdwaras; Bhagya Nagar, Workshop and ITI; the station and airport; Vishnupuri campuses; and the eastern Hira Ghat, Mata Sahib and Shikar Ghat route.
- Twelve jobs involving coaching runs, campus visits, food stops, station/airport trips, an arcade chase, a circuit and riverfront journeys. All job stories are fictional; inclusion does not imply an institution or business commissioned or endorses them.
- Hatchbacks, Ambassador-inspired sedans and auto-rickshaws; pedestrians, road traffic, police pursuit, vehicle damage, boost and recovery.
- A searchable city guide, category and neighborhood filters, a north-up map, GPS routes, free quick travel and discovery tracking.
- Earnings, completed-job count and discovered places saved in browser local storage.

This is a **researched city interpretation**, not an exhaustive list of everything in Nanded or a surveyed replica. Research dated **16 October 2026** provides **64 mapped locations and 65 neighborhood/area anchors**. All building models and entrances are illustrative, and frontages can move beside nearby roads to preserve navigation. The guide labels this distinction. See [coverage and known gaps](research/COVERAGE.md) and the [complete place catalog](public/data/places.json).

Street distances are compressed to **0.5 scale**. North is up on the map; in world coordinates, `+x` points east and `+z` points south. The game has no multiplayer backend, accounts, purchases, gun combat or building interiors. Saves are local to the device/browser and may be unavailable when storage is blocked.

## Development and verification

```sh
npm ci
python scripts/build-city-data.py
npm test
node scripts/verify-world.mjs
npm run build
npm run dev
```

The Python script regenerates the playable road graph, illustrated place placements and public data from the checked-in `research/` snapshots. It does not refresh online sources. Run it after changing research records or placement overrides, then run the checks above.

Use `npm run preview` to inspect the production build. Vite prints the actual preview port if the default is occupied. Production output is static `dist/`; see [DEPLOYMENT.md](DEPLOYMENT.md) for deployment and DNS details.

## Implementation and sources

- `src/main.js`: game loop, input, traffic, police, camera, discovery and UI
- `src/guide.js`: place search, filters, source details and travel actions
- `src/navigation.js`: street-graph navigation and routes
- `src/mobile.js`: compact layout, minimap/job toggles and best-effort landscape controls
- `src/camera-controls.js`: touch/mouse orbit, pitch limits, recentering and camera-relative walking
- `src/map-direction.js`: north-up map headings and camera-relative GPS bearings
- `src/camera-obstruction.js`: keeps the view clear of buildings along the camera path
- `src/intro.js`: animated comic opening, replay, opt-in sound, tab visibility handling and static fallback
- `src/launch.css`: opening panels, typography, transitions and responsive presentation
- `src/world.js` and `src/world-labels.js`: illustrated city geometry, signs and collision data
- `src/vehicles.js`, `src/mechanics.js`, `src/audio.js`: original vehicles, physics, jobs, saves and synthesized sound
- `src/data/network.json` and `src/data/city.json`: generated street graph and placed city catalog
- `scripts/build-city-data.py`: reproducible data conversion and road-clear frontage placement
- `scripts/render-opening.py`: historical 18-second MP4 export and synthesized soundtrack; rebuild using `--key-art assets/art/nanded-key-art-original.png --lanes assets/art/nanded-lanes-original.png`. The current opening does not play this MP4.
- `research/art-prompts.json`: artwork generation provenance; original PNGs are preserved in `assets/art/`, with optimized comic artwork and audio in `public/media/`
- `scripts/verify-live.py`: compare the public domain's build, map data and media byte for byte with `dist/`
- `tests/` and `scripts/verify-world.mjs`: mechanics, navigation, opening lifecycle and world checks. The opening's Node DOM fixture checks timing, controls and cleanup; it does not replace browser rendering or real audio checks.
- `research/`: source snapshots, addresses, coordinate overrides, evidence notes and exclusions

Key sources include the [Nanded district administration](https://nanded.gov.in/en/public-utility-category/colleges/), [Hazur Sahib Board](https://hazursahib.com/web/gurudwara_nagina_ghat), [SRTM University map](https://srtmun.ac.in/srtmun-on-google-map/), [IIB Nanded branch](https://www.iibedu.com/iib-neetcoaching/nanded-branch/), [AAI aerodrome information](https://aim-india.aai.aero/eAIP_Archive/06-08-2026/eAIP/IN-AD%202.1VOND-en-GB.html), and first-party institution and venue pages linked in each catalog record. [Coverage notes](research/COVERAGE.md) explain directory evidence, contradictory addresses and unresolved branches.

**Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).** The OSM snapshots and [downloadable derived street network](public/data/network.json) retain that license and attribution. Original game code and artwork are separate from the map database; the map-data license is not a blanket license for every project asset. Other place evidence retains its recorded source provenance.

Dependencies: Three.js (MIT), Vite (MIT). Interface and sign fonts use Google Fonts Barlow Condensed, DM Sans and Noto Sans Devanagari with local system fallbacks.
