# Nanded landmark research — 16 October 2026

44 candidates in `landmarks.json`: 13 landmarks, 13 junctions, 6 transport places, 6 civic/cultural places, 5 hospitals and 1 park. These are recognizable, source-backed additions, **not an exhaustive census of every city landmark**. Current directory inclusion does not establish opening hours, ongoing operation, visual appearance, or popularity ranking. Facts in `localDetail` deliberately avoid unsupported history and promotional claims.

34 records use first-party or government sources (`official`), 6 use directories, and 4 are principally map records. Here `official` includes first-party institutional/business location statements, not only government ownership. Eight records currently have verified coordinates. Most coordinates remain null for reconciliation against a current map; do not assign a nearby building as if it were surveyed.

## Geography and city boundaries

- Keep the Godavari as the defining geographic divider. The old city and Hazur Sahib riverfront are on the northern side; Waghala/CIDCO and the Vishnupuri approach extend southward. Retain actual OSM river shape when available rather than drawing a straight canal. The municipal report and waterways survey distinguish north-bank old Nanded from newer areas south of the river.
- The **government medical college and hospital is now in Vishnupuri**, on the Nanded–Latur highway. Its [own overview](https://www.drscgmcnanded.in/overview.php) explains the move from the old SGGS Civil Hospital site. The old civil hospital is separately listed on Railway Station Road in Vazirabad by the [district hospital directory](https://nanded.gov.in/en/public-utility-category/hospitals/). Do not allow stale OSM medical-college labels to merge the two campuses.
- Airport reference point is **19°10′52″ N, 77°19′21″ E**. [AAI aerodrome information](https://aim-india.aai.aero/eAIP_Archive/06-08-2026/eAIP/IN-AD%202.1VOND-en-GB.html) places it 5 km northeast of Nanded, in Sangvi (Bk), Old Hingoli Road. That is an aerodrome reference point, not a terminal entrance.
- **Nanded Fort / Nandgiri Fort** is the city riverside fort: [OSM way 826268915](https://www.openstreetmap.org/way/826268915), independently exposed in [Mapcarta](https://mapcarta.com/W826268915). Do not substitute Kandhar Fort or Satara's Nandgiri/Kalyangad fort. Mapcarta gives rounded centre coordinates 19.14161, 77.32477; actual footprint is preferable for placement.
- **Kaleshwar** and the **Vishnupuri barrage** belong to the southwest/Vishnupuri river route. [IWAI's Godavari survey](https://iwai.nic.in/sites/default/files/7825944126NW-04%20Extn%20Godavari%20River%20Final%20FSR_0.pdf) places Kaleshwar temple and ghat near the barrage on the left bank. [Maharashtra Tourism](https://maharashtratourism.gov.in/mr/nature/vishnupuri-dam/) corroborates the Godavari barrage.
- The [mapped central bus stand](https://www.openstreetmap.org/way/912075890) is west of the railway station. No separate Nanded CIDCO bus stand was verified: many search results actually describe CIDCO bus stand in Chhatrapati Sambhajinagar. Do not invent one.
- **Hingoli Gate** is an overbridge landmark corroborated by [the operator's own address](https://www.royalbusonline.com/contact_us). Keep it distinct from outer Namaskar Chowk and airport roads.

## Shrine placement and source traps

The Hazur Sahib Board has useful direct pages and architectural descriptions. Its website footer repeats the Board's Gurudwara Road address on every page; **that is not the location of each outlying shrine**.

- [Nagina Ghat](https://hazursahib.com/web/gurudwara_nagina_ghat): about 400 m southwest of the Takht, at the river; high plinth, square hall, upper domed room.
- [Banda Ghat](https://hazursahib.com/web/gurudwara_banda_ghat): about 400 m upstream of Nagina Ghat; square room with surrounding covered passage.
- [Hira/Heera Ghat](https://hazursahib.com/web/gurudwara_heera_ghat): about 9 km downstream from Nanded. This is an outskirts destination, not another building beside Nagina Ghat.
- [Mata Sahib Devaan Ji](https://hazursahib.com/web/gurudwara_mata_sahib_devaan_ji): about half a kilometre downstream of Hira Ghat.
- [Shikar Ghat](https://hazursahib.com/web/gurudwara_shikar_ghat): about 6 km from the Takht, low hill beside river, white marble cladding, associated river bridge.
- [Mal Tekdi](https://hazursahib.com/web/mal_tekdi_sahib): about 5 km from the Takht, linked to Nanded–Akola Road.
- [Sangat Sahib](https://hazursahib.com/web/gurudwara_sangat_sahib): described as about two miles from the Takht on the Godavari.
- Langar Sahib is separately listed at Baba Nidhan Singh Chowk/Nagina Ghat Road. Its direct website did not load in this research pass, so the record is explicitly `directory`, not asserted as a successful official verification.

## Roads and local navigation

The [Nanded transport study](https://www.jetir.org/papers/JETIR2304408.pdf) describes the north-to-centre sequence Taroda Naka → Raj Corner → Workshop Corner → Shri Nagar, and the city connections through ITI/Phule Market, Shivaji Nagar, Kala Mandir, Vazirabad and the southward Vishnupuri approach. Its study geometry is older and is only supporting context; actual OSM roads should govern the game.

The [PWD contractor's project list](https://www.saketinfra.com/ongoing-projects.php) explicitly names Workshop Corner–Mahatma Phule Chowk–Annabhau Sathe Chowk, and Latur Phata (Ambedkar Chowk)–Dhavale Corner. These give defensible road associations but not exact junction coordinates.

The [IWAI survey](https://iwai.nic.in/sites/default/files/7825944126NW-04%20Extn%20Godavari%20River%20Final%20FSR_0.pdf) names Navghat Road Bridge and Gowerdhan/Govardhan Ghat Road Bridge. Do not assert that every locally described 'New Bridge' is Navghat until current map geometry resolves the naming. No city Godavari railway bridge name was verified, so none is invented.

## Reused project evidence

Read-only references from the separate counterstrike.nanded.fun project (`nanded-strike/public/`) were consulted; that project was not edited:

- `map-reference.json`: Workshop Corner coordinate 19.1800057, 77.3041901 is the actual Vazirabad Road junction; nearby OSM node 7635002071 carries Workshop Corner address. Bhagya Nagar road junction is 19.1772071, 77.3093858, with nearby OSM node 7635002096 identifying Bhagya Nagar Kaman.
- `landmark-reference.json`: Bhagya Nagar Kaman coordinate 19.17722, 77.3093456 agrees with the mapped entrance junction within five metres; actual photographic observations include large Marathi lettering, cream beam, dark central pier and two openings. **Kupi's AI illustration was explicitly rejected** in that earlier visual inspection; do not use it for architecture.
- `district-landmark-reference.json`: Kake Di Hatti Nanded was shown as permanently closed in the inspected Google listing despite the brand locator retaining the address. Restaurant researcher/root was warned to avoid a current-active claim.

From this task's `research/osm-places.json`, exact location matches were adopted for Kaleshwar Temple (way 717024610), SGGS Memorial Government Hospital (node 7634424724), Shivaji Maharaj Putla (node 13710087819), and central bus stand (way 912075890). `coordinateSourceUrl` records these separate coordinate sources while retaining the primary textual evidence. A generic 'Women Hospital' point opposite Pharmacy College was not assumed to identify the government women's hospital without further confirmation.

## Explicit limits and exclusions

Mahur, Kandhar, Sahastrakund, Hottal, Unkeshwar and other distant district attractions are excluded from this city map. Maharashtra Tourism district pages intermingle those destinations with Nanded city; their prose should not determine placement. No private residential names, addresses, phone numbers, electoral details or identity documents found in noisy searches were copied into the game dataset. Place names and location facts only are used; source photographs were not redistributed.

Landmarks can be exterior visit destinations. Architectural detail still needs actual photo references before claiming a recognisable reconstruction. Directory names alone do not establish a building's shape. Vishnupuri, the airport and Hira/Mata Sahib are meaningful outskirts trips, so a compressed city map should clearly disclose its changed travel distances.

## Landmark expansion — 16 October 2026

Added four city destinations, bringing this source group to **48 records** and the game's landmark category to **17** (133 total catalog records). The expansion does not rank fame or claim complete city coverage.

| New ID | Identity evidence | Placement status |
| --- | --- | --- |
| `urvashi-ghat` | [Ministry of Tourism, Incredible India — Nanded](https://www.prod.incredibleindia.gov.in/content/incredible-india-v2/en/destinations/nanded.html) explicitly names Urvashi among the city's river ghats. | Riverfront area anchor from public-site photograph 02, NGT report page 95; no surveyed entrance. |
| `ram-ghat` | [IWAI Godavari River Final Feasibility Report](https://iwai.nic.in/sites/default/files/7825944126NW-04%20Extn%20Godavari%20River%20Final%20FSR_0.pdf), page 244, locates Ram Ghat/Shani Mandir near the Vikas Nagar–Old Mondha bridge. Incredible India independently names Ram Ghat. | Old Mondha bridge-end area anchor from the retained OSM network. Exact bridge-name match and ghat entrance unresolved. |
| `govardhan-ghat` | Incredible India names Govardhan Ghat; the IWAI report uses the spelling Gowerdhan. | Upstream riverfront area anchor from public-site photograph 10, NGT report page 99; not the exact ghat entrance. |
| `old-mondha-clock-tower` | [BPCL's Maharashtra retail-outlet location notice](https://www.petrolpumpdealerchayan.in/uploads/advertisementpdfs/H2_ENGLISH_MAHARSTRA.pdf?5f64=), PDF page 51, row 1116, explicitly identifies Clock Tower (Old Mondha) in Nanded city. | Named adjacent garden point from a directory, kept as an area anchor. |

The [NGT report](https://www.greentribunal.gov.in/sites/default/files/news_updates/Report%20of%20the%20Joint%20Committee%20in%20OA%20No.92-2025%20%28page%20nos.53-118%29.pdf) was available through indexed page text, while direct fetching returned 403; this evidence status is retained in the coordinate notes. Only the two coherent Nanded riverfront photo geotags were used. No environmental-condition claim from that report is added to the game. Direct reads of the older Incredible India and IWAI pages timed out; their indexed primary-source text supplied the named-place confirmation.

[Shubham Takode's original Old Mondha Clock Tower photograph](https://commons.wikimedia.org/wiki/File:Old_Mondha_Clock_Tower,Nanded.jpg) is dated 2 October 2012 and provides a historical visual reference. It does not establish the present condition or construction date. The source image is not redistributed in the game.

Recommended landmark passport IDs are `hazur-sahib`, `nagina-ghat`, `banda-ghat`, `langar-sahib`, `hira-ghat`, `mata-sahib`, `shikar-ghat`, `mal-tekdi`, `sangat-sahib`, `nandgiri-fort`, `kaleshwar-temple`, `vishnupuri-dam`, `godavari-river`, `urvashi-ghat`, `ram-ghat`, `govardhan-ghat`, and `old-mondha-clock-tower`. Existing broader city icons `bhagya-nagar-kaman`, `shivaji-putla`, `sggs-stadium`, and `nanded-station` can be featured separately without recategorizing them as additional landmark records.

The [district administration's Bavari Nagar Dabhad Mahavihar page](https://nanded.gov.in/en/tourist-place/bavari-nagar-dabhad-mahavihar/) identifies a major outlying Buddhist site but gives conflicting road distances. Its exact coordinate and relationship to the current northern map bound remain unresolved, so it is not fabricated inside the city. Mahur, Kandhar, Sahastrakund, Hottal and Unkeshwar remain excluded district trips.
