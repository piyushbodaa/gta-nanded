# GTA NANDED

An original, single-player 3D browser adventure built for **gta.nanded.fun**, set in Nanded, Maharashtra. Start on foot at **Zenda Chowk, Taroda Khurd**, meet a friend, explore your lane and choose from **nine optional activities**. Walk, sprint, jump, talk and take landmark photos; pick up a vehicle when you want to drive. The city contains **133 researched places** along compressed OpenStreetMap streets and a **17-landmark passport**.

The playable vehicles, characters, building illustrations, signage and synthesized audio are made in code. The opening animates original comic artwork in the browser with a newly composed soundtrack. The street network comes from real map data; the game buildings are original illustrations.

## Play

- **WASD / arrow keys:** drive or walk; walking follows the direction of the camera
- **Drag the street / swipe the screen:** look around and tilt the camera
- **C / Center camera button:** return the camera behind your character or vehicle
- **E:** enter or exit a nearby vehicle; slow down before exiting
- **Space:** jump on foot / handbrake in a vehicle
- **Shift:** boost or sprint
- **Q / Talk or Photo button:** interact at the current activity marker or photograph a nearby landmark
- **B / Activities button:** choose an activity or open the landmark passport
- **H:** horn; enable sound first
- **M:** open the city guide and map; clicking the minimap also opens it
- **Escape:** pause or resume
- **R:** recover and repair your vehicle, costing up to ₹100 of in-game earnings
- **N:** open the activity picker after completion or in free roam; retry a failed activity

Touch devices have direction, **Jump**, **Run**, enter/exit and map buttons, plus contextual **Talk / Photo** actions. Jump and Run become brake and boost controls in a vehicle. While driving, the **Joystick** button swaps the arrow pad for an analog stick: push up to accelerate, sideways to steer, down to brake or reverse; a partial push cruises at a lower speed. The choice is remembered on the device and the arrow pad always returns on foot. Hold a movement button with one finger and drag the open street with another to look around. Looking around holds its angle while stopped; driving recenters the view after two seconds without a drag. The camera moves closer when a wall, roof or sign would block the character. Both maps stay north-up, and their player arrows show character/vehicle facing. The GPS-card arrow points toward the destination relative to your camera. The mobile minimap starts hidden behind **Mini map**, and activity details start collapsed; tap the chevron to expand them. Use the Controls button to pause. Portrait mode shows a dismissible rotation hint. **Wide view** requests fullscreen and landscape orientation where supported; otherwise, turn the phone sideways. A modern WebGL2-capable browser is required.

Choose **Start Your Story** for an untimed on-foot homecoming: talk to your friend at Zenda Chowk, walk around the lane, then take your first photo. **Free Roam** starts on foot without an active challenge. The original **12-second animated comic opening** can be skipped immediately or replayed with **Replay Intro**. Sound starts off; the opening's sound button keeps your choice for later replays on the same page. If the browser blocks sound, the sequence continues silently. Reduced-motion preferences, unavailable animation or failed artwork loading use a still opening with a continue button. Switching to another tab pauses the sequence and its music until you return.

The entrance and opening feature **“उगं नव्हं मय, नांदेड हाय नांदेड!”**, with Marathi welcome messages and fictional local conversations in the lane, coaching and college activities.

Your run begins beside the public **Zenda Chowk (झेंडा चौक)** in **Taroda Khurd**, near Chhatrapati Chowk. The starting lane includes a grey-blue home with yellow accents, a striped metal gate and greenery: an original illustrative home. It is a fictional setting, not a claim to identify or locate a private residence.

Open **Activities** to choose the Zenda homecoming, Taroda foot sprint, Hazur postcards, Godavari frames, college reunion, coaching break, Visava evening, street circuit or arcade getaway. Each card takes you to its starting point. The sprint, race and getaway have timers; the other six activities let you explore at your own pace. **Just roam** leaves the current challenge and returns to free exploration.

The **Landmark passport** lists 17 places, including Hazur Sahib, Nandgiri Fort, Kaleshwar, Vishnupuri Dam, Mal Tekdi, the riverfront ghats and Old Mondha Clock Tower. Choose **Visit on foot** for free instant travel, or reach a mint photo ring yourself. Press **Q** or tap **Photo** on foot to collect a stamp and a one-time **₹150** reward for that landmark. Stamps persist in browser storage, so returning to an already collected place does not award the stamp again. A brief in-game photo preview accompanies the action; the image itself is not a saved photo album. Activity photos elsewhere, such as the Zenda lane or a college, advance their activity without adding an extra passport landmark.

Open the city guide to search names, aliases and neighborhoods, filter categories, or find places still to discover. Select **Set destination** for a street-following GPS route, or **Go there · free** for instant travel. Both actions switch to free roam without an activity timer.

Amber rings mark activity objectives. Talk and photo objectives require an explicit action on foot; race checkpoints require a vehicle and can be taken at speed. Collisions and taking occupied traffic vehicles attract police; evade patrols to lose your wanted level. Rewards and fines use fictional in-game rupees, never real money.

## Included

- 133 places across 53 locality labels: coaching institutes, colleges, schools, landmarks, junctions, transport stops, hospitals, civic buildings, a park, hotels, restaurants, cafés, cinemas and shopping places.
- Seventeen passport landmarks, including newly added Urvashi Ghat, Ram Ghat, Govardhan Ghat and Old Mondha Clock Tower; familiar junctions, the station, airport and Vishnupuri campuses remain in the city guide.
- Nine repeatable activities covering local conversations, photo walks, a foot sprint, a street circuit and a getaway. All stories are fictional; inclusion does not imply an institution or business commissioned or endorses them.
- Hatchbacks, Ambassador-inspired sedans and auto-rickshaws; pedestrians, road traffic, police pursuit, vehicle damage, boost and recovery.
- A searchable city guide, category and neighborhood filters, a north-up map, GPS routes, free quick travel and discovery tracking.
- Earnings, completed-activity count, discovered places and landmark passport stamps saved in browser local storage.

This is a **researched city interpretation**, not an exhaustive list of everything in Nanded or a surveyed replica. Research dated **16 October 2026** provides **64 mapped locations and 69 neighborhood/area anchors**. The added ghats and Clock Tower all retain approximate area placement. Landmark architecture uses illustrated silhouettes and details; no model or entrance is a measured reconstruction. Frontages can move beside nearby roads to preserve navigation, and the guide labels the coordinate distinction. See [coverage and known gaps](research/COVERAGE.md) and the [complete place catalog](public/data/places.json).

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
- `src/adventures.js` and `src/adventures.css`: activity picker, landmark passport, photo-spot eligibility and stamp storage
- `src/navigation.js`: street-graph navigation and routes
- `src/mobile.js`: compact layout, minimap/job toggles and best-effort landscape controls
- `src/camera-controls.js`: touch/mouse orbit, pitch limits, recentering and camera-relative walking
- `src/joystick.js`: optional analog touch stick for driving
- `src/map-direction.js`: north-up map headings and camera-relative GPS bearings
- `src/camera-obstruction.js`: keeps the view clear of buildings along the camera path
- `src/intro.js`: animated comic opening, replay, opt-in sound, tab visibility handling and static fallback
- `src/launch.css`: opening panels, typography, transitions and responsive presentation
- `src/world.js` and `src/world-labels.js`: illustrated city geometry, signs and collision data
- `src/vehicles.js`, `src/mechanics.js`, `src/audio.js`: original characters and vehicles, physics, activity objectives, saves and synthesized sound
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

## Contributing

GTA Nanded is open source and pull requests are welcome. Clone the repository, run `npm ci` and `npm run dev`, and see [CONTRIBUTING.md](CONTRIBUTING.md) for the checks to run and how to submit a change.

## License

The code, artwork and audio are released under the [MIT License](LICENSE). Street-network data derived from OpenStreetMap is © OpenStreetMap contributors under the [ODbL](https://opendatacommons.org/licenses/odbl/1-0/); see [NOTICE](NOTICE) and [research/COVERAGE.md](research/COVERAGE.md).
