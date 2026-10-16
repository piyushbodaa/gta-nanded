# Nanded city coverage — 16 October 2026

The playable catalog contains **129 researched records** across Nanded-Waghala and adjoining urban/outskirts destinations. It is a verified candidate set based on available public sources, not a census of every business, class, college or landmark, and not a ranking of fame. `verifiedAt` records the research date; it does not establish that a venue is open today or that an older source was published that day.

The complete generated records are in [public/data/places.json](../public/data/places.json). Category counts below match [src/data/city.json](../src/data/city.json).

| Category | Records |
| --- | ---: |
| Coaching institutes/branches | 13 |
| Colleges, university and technical institutions | 24 |
| Schools | 8 |
| Landmarks and riverfront destinations | 13 |
| Junctions | 14 |
| Transport places | 6 |
| Civic and cultural places | 6 |
| Hospitals | 5 |
| Park | 1 |
| Hotels and pilgrim stays | 15 |
| Restaurants and sweet shops | 13 |
| Cafés | 6 |
| Cinemas | 2 |
| Shopping/market places | 3 |
| **Total** | **129** |

The source groups are **45 education**, **44 landmarks/civic/transport/health**, **39 food/hotel/cinema/shopping**, and **one separately researched starting junction**, Zenda Chowk. The catalog has **53 address-area labels** after normalizing Vasarani/Vasarni; these are convenient locality, street and sector groupings, not 53 official administrative wards. A charitable yatri niwas uses the game's lodging category without implying it is a commercial hotel. The medical college and hospital remain two catalog records at a shared campus, and PVR is separately discoverable within the Treasure Bazaar complex; 129 records does not mean 129 distinct real buildings.

## Geographic fidelity

**64 records use mapped locations; 65 use area anchors.** `confidence` describes the venue/address source (`official`, `mapped` or `directory`); `locationPrecision` independently describes coordinate evidence (`mapped` or `area`). An official address can still have only an approximate game placement.

- **Mapped:** a named map point, institution-published coordinate, location code or campus/footprint centre reconciled with the address. This is not necessarily a surveyed entrance.
- **Area:** a known neighborhood, nearby feature, campus precinct, street or village centre consistent with the address. The actual frontage is unverified.
- **Illustrated frontage:** every place receives original game architecture beside a reachable road. Models can be shifted away from source coordinates to avoid roads and other models. Source `lat`/`lon` and projected `geoX`/`geoZ` remain separate from rendered `x`/`z`; `frontageShiftMetres` records that movement. The current snapshot's largest shift is 450 real-world metres, in addition to any uncertainty in an area anchor.

Street, river and rail shapes come from the **16 October 2026 OpenStreetMap snapshot**, projected around latitude 19.16 / longitude 77.31 at **0.5 scale**. East is `+x`, south is `+z`, and maps are north-up. Road bends are simplified while shared junctions are preserved; the playable graph uses the largest connected street component. The snapshot contains 21,764 playable graph nodes and 26,252 edges; 94 disconnected source nodes are omitted. It is an arcade navigation graph, not real-world driving directions or a complete traffic-rule simulation.

The source bounds are **19.07–19.23° N, 77.24–77.425° E**. Hira Ghat, Mata Sahib and Shikar Ghat genuinely lie east of the original 77.40° cutoff; the bounds were extended instead of relocating them into the city centre. Vishnupuri stays southwest of the central city, the airport stays northeast, and the Godavari retains its mapped course.

The starting point uses the public **Zenda Chowk (झेंडा चौक)** listing at **19.1930005° N, 77.291982° E**, on the Chhatrapati Chowk to Kabra Nagar road in **Taroda Khurd**. The game spawn is moved onto a safe nearby road position. These decimals preserve the source pin, not survey-grade precision. Zenda Chowk and Chhatrapati Chowk are separate junction names; the latter is a nearby address reference, not an alias. [Spawn evidence and corroboration](spawn-location-notes.md) preserve the public map listing and official school-bus-route references.

The starting lane's grey-blue house, yellow parapet details, black-and-white gate and surrounding greenery are an original model inspired by supplied visual references. They do not establish a private house's exact address, resident identity or measured layout. The house is scenery attached to the public junction setting, not an additional researched venue.

## Evidence and reproduction

| File | Role |
| --- | --- |
| [education.json](education.json), [education-notes.md](education-notes.md) | Coaching branches, colleges and schools; source conflicts and identity checks |
| [landmarks.json](landmarks.json), [landmarks-notes.md](landmarks-notes.md) | Landmark, civic, transport, health, park and junction evidence |
| [spawn-location.json](spawn-location.json), [spawn-location-notes.md](spawn-location-notes.md) | Public Zenda Chowk pin, Taroda Khurd setting and spelling aliases |
| [food-hotels.json](food-hotels.json), [food-hotels-notes.md](food-hotels-notes.md) | Food, lodging, cinemas and shopping; branch and operating-status caveats |
| [placement-overrides.json](placement-overrides.json), [placement-notes.md](placement-notes.md) | Coordinates, explicit area anchors, aliases, rejected map matches and provenance |
| [osm-network.json](osm-network.json), [osm-places.json](osm-places.json) | Retained OSM geometry and named-place snapshots |

Run from the project root:

```sh
python scripts/build-city-data.py
npm test
node scripts/verify-world.mjs
npm run build
```

Generation reads the research snapshots and writes `src/data/network.json`, `src/data/city.json`, `public/data/network.json` and `public/data/places.json`. It reproduces this researched snapshot rather than silently treating live map changes as verified. Original research reused selected coordinate/photo evidence from the separate local `counterstrike.nanded.fun/nanded-strike/public/` project without modifying it; relevant public URLs and matching decisions are preserved in the notes.

## Key primary sources

- [Nanded district college directory](https://nanded.gov.in/en/public-utility-category/colleges/), [school directory](https://nanded.gov.in/en/public-utility-category/schools/) and [hospital directory](https://nanded.gov.in/en/public-utility-category/hospitals/).
- [Hazur Sahib Board — Nagina Ghat](https://hazursahib.com/web/gurudwara_nagina_ghat), [Hira Ghat](https://hazursahib.com/web/gurudwara_heera_ghat), [Mata Sahib](https://hazursahib.com/web/gurudwara_mata_sahib_devaan_ji), [Shikar Ghat](https://hazursahib.com/web/gurudwara_shikar_ghat), and [pilgrim accommodation](https://hazursahib.com/web/room_booking). The Board's repeated website footer is not an address for every outlying shrine.
- [SRTM University main-campus map](https://srtmun.ac.in/srtmun-on-google-map/), [Government College of Education contact](https://gcenanded.co.in/contactus.php), [government medical college overview](https://www.drscgmcnanded.in/overview.php), and [Nanded Pharmacy College geotag evidence](https://nandedpharmacycollege.org/admin/uploads/criteria3/3_2_2.pdf).
- [IIB's Nanded branch](https://www.iibedu.com/iib-neetcoaching/nanded-branch/) and [PW's Nanded centre](https://www.pw.live/offline-centres/batches/vidyapeeth/nanded-mh/nanded-vidyapeeth-322381), with the PW address conflict retained in education notes.
- [AAI Nanded aerodrome information](https://aim-india.aai.aero/eAIP_Archive/06-08-2026/eAIP/IN-AD%202.1VOND-en-GB.html), [IWAI Godavari survey](https://iwai.nic.in/sites/default/files/7825944126NW-04%20Extn%20Godavari%20River%20Final%20FSR_0.pdf), and [Maharashtra Tourism's Vishnupuri page](https://maharashtratourism.gov.in/mr/nature/vishnupuri-dam/).
- [Crazy Cheesy locator](https://www.crazycheesy.com/store-locator/), [Chaiway main-branch contact](https://chaiwaychai.com/contact-us/), [Hotel Aakruti contact](https://akrutihotels.com/549-2/), [Pizza Hut's Shivaji Nagar outlet](https://restaurants.pizzahut.co.in/pizza-hut-ph-shivaji-nagar-nanded-pizza-restaurant-vishnu-nagar-nanded-121523/Home), and [Domino's Nanded locator](https://www.dominos.co.in/store-location/nanded/salasar-square-nanded-maharashtra).

Institutional directories, booking pages, map records and other public directories supplement first-party pages where needed. A university's hotel directory is independent address evidence, not a first-party statement from each hotel. Municipal/PWD street descriptions and older NWCMC reports establish context but do not resolve exact frontage coordinates. Contradictory or stale source addresses remain documented in the individual notes.

## Gaps, exclusions and identity decisions

More independent coaching classes, subject tutors, commerce classes, eateries, hotels and local shops remain unresolved. New Mondha, Degloor Naka, CIDCO/HUDCO and north Taroda food coverage needs further branch-by-branch checking. Other IIB campuses, Chaiway Open Sky/Parvati branches, Hari Om Rabri Wala and A & Son's Bangalore Bakery remain leads rather than silently added duplicates. No claim that “everything” or “all famous places” is complete is supported by this set.

Kake Di Hatti was excluded after the inspected map listing indicated permanent closure despite an old brand locator entry. Visawa Palace is represented as a hotel exterior; a temporarily closed restaurant listing does not justify claiming it currently serves meals. Older Jyoti/Carnival, Shyam and Habib cinema listings were not treated as proof of current screening activity. These are research observations as of the check date, not permanent declarations about future operation.

Grand Tulsi uses the older Tulsi Comfort aliases for the same property. NES Science College and Science College are one institution; People's College is separate. Yeshwant College of Physical Education in CIDCO is distinct from Yeshwant Mahavidyalaya. Three Chate branches and three Domino's branches are separately sourced. The government's Vishnupuri medical campus is distinct from the old SGGS Civil Hospital in Vazirabad; the obsolete central medical-college map pin was rejected.

Search results for Nanded City in Pune, other cities' similarly named institutions, and distant district attractions were excluded. Kandhar Fort, Mahur, Sahastrakund, Hottal and Unkeshwar are not disguised as central Nanded landmarks. Nanded's Sarafa market does not inherit Indore Sarafa's night-food-market description.

## Gameplay and attribution

The twelve jobs, characters, encounters, rupee rewards, chases and venue visits are fictional. Real names support local familiarity; they do not imply affiliation, sponsorship or real commercial services. Free roam, guide search, GPS, free instant travel and browser-local discovery saves let players explore beyond the jobs.

The original **12-second animated comic opening** moves illustrated panels in the browser; it is not documentary footage or geographic evidence. It can be skipped or replayed, starts with sound off, pauses while the tab is hidden, and has a still fallback for reduced motion, unavailable animation or failed artwork loading. The sound toggle retains its setting for replays on the same page; blocked sound does not prevent the opening from finishing. The earlier 18-second MP4 is a historical export and is not used by the current opening. [Artwork prompts](art-prompts.json) record the creative direction.

The compact mobile interface hides the minimap and collapses job details by default. Its wide-view control requests fullscreen and landscape only where the browser supports them; physical phone rotation remains the fallback.

**Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright).** The OSM extracts and [downloadable derived street-network database](../public/data/network.json) are available under the [Open Data Commons Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/); retain attribution and the license when redistributing this data. Other place records retain individual source provenance, including Overture provider details described in placement notes. Original game code, procedural artwork and synthesized audio are separate works; the ODbL notice does not relicense every asset. Source photographs are not redistributed.
