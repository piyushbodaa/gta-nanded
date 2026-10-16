# Placement reconciliation — 2026-10-16

All 132 source records have a placement override: **63 mapped points and 69 area anchors**. This file reconciles `education.json`, `food-hotels.json` and `landmarks.json`; it does not assert every venue has a surveyed entrance or exact facade model.

## Meaning of precision

- `mapped`: a named map point, published coordinate, official map link, decoded location code, or named OSM footprint/campus centre matched to the independently researched address. A campus centre is not a front-door survey. Third-party map data can still contain errors.
- `area`: a nearby known point, street/campus precinct or village centre consistent with the address. The note explicitly states the exact frontage is unverified. Coordinate precision in decimal places does not increase this evidence status.
- Multiple venues intentionally share an area/campus anchor; the game should distribute nearby frontages while preserving their area labels. Such visual spacing must not be described as real building coordinates.
- Government medical college and hospital intentionally share the Vishnupuri campus point, while remaining two catalog records. River/bridge entries should use geographic shapes instead of ordinary venue buildings.

## Local evidence reused without modifying its source

`osm-places.json` and `osm-network.json` are the 2026-10-16 OSM extracts. `coordinateSourceUrl` links to the corresponding OSM node/way where relevant. OSM data requires OpenStreetMap contributor attribution and ODbL compliance.

Read-only prior project evidence: `/home/piyushbodaa/Projects/counterstrike.nanded.fun/nanded-strike/public/place-source.json`, `map-reference.json`, `landmark-reference.json`, and `district-landmark-reference.json`.

Six exact name-and-address Overture matches were retained: Godavari Sweets, Frespresso, Great Achievers, C Square, Chaiway and Kusum Auditorium. Source feature UUIDs and source pages are recorded per override. The prior source uses Overture release 2026-09-23.1 with provider-level provenance; most of these points originate from Meta under CDLA-Permissive-2.0, and Great Achievers from Microsoft. Do not label Overture confidence scores as measured location accuracy. Amrut Cafe and Grand Tulsi use the prior project's coordinate/photo corroboration.

## Additional public coordinates checked

- [SRTM official map page](https://srtmun.ac.in/srtmun-on-google-map/) links the Nanded main campus at **19.102196, 77.2843176**. Other map links on that page lead to Latur/Hingoli sub-campuses and were not used.
- [Government College of Education official contact page](https://gcenanded.co.in/contactus.php) embeds the named plus code **58H9+X74**. Decoding the Nanded full code `7JFV58H9+X74` yields **19.1798875, 77.318203125**.
- [Science College research](https://www.ijirmf.com/wp-content/uploads/IJIRMF202003036.pdf) places the campus at 19°10′29″N, 77°18′01″E near Agriculture College, consistent with the OSM NES campus. A second college-authored study at https://www.jetir.org/papers/JETIR2101081.pdf agrees.
- The [Vishnupuri medical campus directory pin](https://www.courierslist.com/detail/india/nanded/medical-college/1790118/dr-shankarrao-chavan-govt-medical-college-26-hospital) at **19.1107015, 77.2909403** matches the blood-bank OSM node within about 10 metres and the official Vishnupuri address.
- [Discover Sikhism historic-gurdwara directory](https://www.discoversikhism.com/sikh_gurdwaras/historic_sikh_gurdwaras.html) explicitly supplies the seven outlying/riverfront gurdwara coordinates used. The specific selected entries are not labelled approximate by that directory. Hazur Sahib uses OSM; [Langar Sahib](https://www.waze.com/af/live-map/directions/gurudwara-langar-sahib-langer-saheb-road-nanded?to=place.w.50659519.506660731.12119760) uses Waze venue/JSON-LD coordinates.
- [Bharat E Square](https://www.moviebuff.com/nanded-bharat-e-square-multiplex-meera-arcade) has a named map link at **19.19503833973871, 77.27947791415556**, on the Canal Road side of town. [D-Mart](https://fndy.in/nanded-waghala/grocery-stores/dmart-nanded) is **19.1930163, 77.2845819**, corroborated by code `57VM+6R4` and independent Wadi Budruk store addresses. Podar and Narayana use this vicinity only as area anchors.
- Treasure Bazaar/PVR coordinates agree within the southern Latur Road mall parcel. The catalog's Vasarani name is retained even where some maps use New Kautha.
- Shankarrao Chavan Auditorium's listed plus code `5886+8CW` decodes to **19.1658625, 77.311078125** near the stadium, consistent with the municipal development-plan description.

## Corrections and rejected matches

- **Grand Tulsi** is a name override of `tulsi-comfort`, preserving Tulsi Comfort aliases. The coordinate/photo match, OSM node 11145755039 and Overture feature 9559940a-6dc8-458e-9104-422f14b9a870 agree on the same property.
- Rejected **OSM node 7225067286**, the stale government-medical-college location at central Vazirabad. Do not move either Vishnupuri campus record back to it.
- Rejected the Overture Science College pin east of the actual NES campus and the low-confidence People's College point lacking a matching street address. People's College is an NES-campus area anchor.
- Rejected a Physics Wallah point advertising Kamal Heights/Bhagya Nagar and an inconsistent postcode; the official record says Ganesh Heights/Anand Nagar. PW is therefore an Anand Nagar area anchor.
- Rejected the WorldPlaces Bharat E Square pin east of the airport because its location conflicts with the documented Meera Arcade/Canal Road address and the named cinema map link.
- Gyan Mata's official address is near the airport on Kamtha Road. The western Nasratpur village centre was not substituted. Directory metadata at 19.179199,77.332139 is used only as **area**, because that source warns its geocoding is automatic.
- Hassapur means the Nanded-side Waghi Road locality; the same-name Bhokar village is not used.
- Generic web results for Vishnupuri dam contain multiple contradictory coordinates, some dozens of kilometres away. The government MJP intake/source coordinate is retained only as a **reservoir-area anchor**, not precise dam alignment.

## Bounds and unresolved frontage work

Only three points exceed the originally requested east bound 77.40: Hira Ghat **19.160094,77.400040**, Mata Sahib **19.155535,77.406473**, and Shikar Ghat **19.129661,77.411608**. They fit the parent's revised longitude bound **77.425**. No point exceeds latitude 19.07–19.23 or longitude 77.24–77.425.

The coarsest remaining placements are the MHADA/Latur Phata hotel/chowk pair, the central Vazirabad civic buildings/junctions, DRM Campus gate, Pasadgaon/Puyni school entrances, and several grouped Hazur Sahib lodging buildings. These are useful neighborhood inclusions, not exact replicas. Local photographs or user corrections would improve frontage placement. The separate research files retain venue/address evidence.

## Validation

Checked exactly 132 unique keys, equality with all three source ID sets, finite numeric coordinates, HTTPS provenance, allowed precision values, and bounds. Existing non-null coordinates from source research are retained. The data contains no invented opening hours, ratings, rankings or claims of exhaustive coverage.

## Landmark expansion — 16 October 2026

Four additions use deliberately conservative `area` precision:

- `urvashi-ghat`: **19.148419, 77.303009**, the public-site photo geotag in the [NGT joint-committee report](https://www.greentribunal.gov.in/sites/default/files/news_updates/Report%20of%20the%20Joint%20Committee%20in%20OA%20No.92-2025%20%28page%20nos.53-118%29.pdf), printed page 95, photograph 02. This locates the vicinity, not a surveyed visitor entrance.
- `govardhan-ghat`: **19.148593, 77.308444**, the same report's printed page 99, photograph 10, explicitly upstream of Govardhan Ghat. This is an upstream precinct anchor. Other photos contain inconsistent geotags and were not adopted. The indexed page text supplied these two references; direct PDF fetch returned 403 during this pass.
- `ram-ghat`: **19.1465972, 77.3188469**, the north end of [OSM bridge way 102662423](https://www.openstreetmap.org/way/102662423), retained in the existing network snapshot. The [IWAI river survey](https://iwai.nic.in/sites/default/files/7825944126NW-04%20Extn%20Godavari%20River%20Final%20FSR_0.pdf), page 244, places Ram Ghat/Shani Mandir near the Vikas Nagar–Old Mondha bridge. The OSM bridge is unnamed, so its name match and the exact ghat frontage remain unresolved.
- `old-mondha-clock-tower`: **19.1484185, 77.3194321**, the named adjacent Clock Tower/Sw. Venugopal Biyani Udyan listing in [DataGemba's park directory](https://datagemba.com/b/v/in/nanded/parks). BPCL independently identifies the tower in Old Mondha. The park point is a precinct anchor, not a measured tower footprint.

The unchanged builder placed the four illustrations beside connected streets. The street-network files and Zenda spawn remained unchanged. Sources establish place identity and vicinity; this expansion does not imply verified present-day opening hours, precise entrances, or exhaustive landmark coverage.
