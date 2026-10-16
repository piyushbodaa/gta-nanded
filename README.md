# Nanded: Street Stories

An original, single-player 3D browser driving game built for **gta.nanded.fun**.
Inspired by early open-world driving games and the streets of Nanded, Maharashtra.
All city geometry, vehicles, characters, signage and audio are generated in code;
no GTA assets, music or branding are included.

## Play

- **WASD / arrow keys:** drive or walk
- **E:** enter or exit a nearby vehicle (slow down before exiting)
- **Space:** handbrake
- **Shift:** boost or sprint
- **H:** horn (enable sound first)
- **M:** open the city map; clicking the minimap also opens it
- **Escape:** pause or resume
- **R:** recover and repair your vehicle, costing up to ₹100 of in-game earnings
- **N:** accept the next job or retry after completion/failure

Touch devices have direction, brake, boost, enter/exit and map buttons. Use the
Controls button to pause. A modern WebGL2-capable browser is required.

Start with **Hit the streets** to drive, or **Explore on foot** to walk.
For delivery jobs, enter the amber ring in a vehicle and slow below 36 km/h.
Race checkpoints can be taken at speed. Collisions and taking occupied traffic
vehicles attract police; evade patrols to lose your wanted level. Jobs and fines
use fictional in-game rupees, never real money.

## Included

- A dense stylized city with bilingual shop signs, apartments, rooftop water
  tanks, markets, pedestrians, traffic, palms and a Godavari riverfront.
- Hazur Sahib, a railway station, ghat, market, stadium and university precinct.
- Hatchbacks, Ambassador-inspired sedans and auto-rickshaws to drive.
- Five repeatable jobs: passenger fare, parcel delivery, timed circuit,
  police getaway and a three-stop delivery.
- Vehicle damage, regenerative boost, police pursuit, recovery and fines.
- Local minimap, route line, full city map, sound toggle and pause controls.
- Earnings and completed-job count saved in browser local storage.

This is a fictional, compressed city interpretation, **not a geographically
accurate reconstruction**. It is single player; it has no multiplayer backend,
accounts, purchases, gun combat or building interiors. Progress is device/browser
local and may be unavailable in browsers that block storage.

## Development

```sh
npm ci
npm run dev
npm test
npm run build
npm run preview
```

Vite prints the actual preview port if the default port is occupied. Production
output is static `dist/`; it can be hosted on Vercel or any static web host.
See [DEPLOYMENT.md](DEPLOYMENT.md) for the configured project and DNS.

## Implementation

- `src/main.js`: game loop, input, traffic, police, camera, maps and UI
- `src/world.js`: instanced Three.js city geometry and collision data
- `src/vehicles.js`: original low-poly vehicles and characters
- `src/mechanics.js`: deterministic physics, collision, missions and save logic
- `src/audio.js`: gesture-activated synthesized engine, horn and cues
- `tests/mechanics.test.js`: collision, handling, mission and storage coverage

## Local references

The landmark selection was checked against the district administration's
[Hazur Sahib page](https://nanded.gov.in/en/tourist-place/sachkhand-gurudwara/)
and Maharashtra Tourism's
[Hazur Sahib / Godavari description](https://maharashtratourism.gov.in/temple/hazur-sahib-gurudwara/).
Map positions, routes, businesses and all missions are fictional game design.
Kandhar Fort is outside Nanded city and is deliberately not represented as a
city-center landmark.

Dependencies: Three.js (MIT), Vite (MIT). Interface fonts use Google Fonts
Barlow Condensed and DM Sans with local system fallbacks.
