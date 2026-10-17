# Zenda Chowk spawn reference

Verified 2026-10-16. This record identifies a **public junction**, not a residence.

## Coordinate evidence

The [Google Maps public Zenda Chowk listing](https://www.google.com/maps/place/Zenda+Chowk/@19.1930005,77.291982,17z/data=!3m1!4b1!4m6!3m5!1s0x3bd1d77746c0453d:0x585fd8e032f20f3b!8m2!3d19.1930005!4d77.291982!16s%2Fg%2F11rn7mg38_) was opened and read in the browser. The selected place URL gives latitude **19.1930005** and longitude **77.291982**; the visible listing gives plus code **57VR+6Q Nanded**. Its address places it on the Chhatrapati Chowk to Kabra Nagar road, in Ashtvinayak Nagar, Taroda Kh., Nanded 431605. The displayed Marathi name is झेंडा चौक.

The coordinate is the published junction pin. It is not a surveyed road intersection or an assurance that the map marker is accurate to the final decimal. `locationPrecision: mapped` means a named public place has a source pin; it does not mean survey-grade accuracy. Spawn should be snapped to a safe traversable position on the corresponding road in the game.

## Corroboration and names

The [official Podar International School Nanded bus-route chart](https://www.podareducation.org/Uploads/transportbusroutes/podareducationnetworktransportbusroutes_nanded.pdf), page 1, lists **Zhenda Chowk** at the start of route N-5, and **Jhenda Chowk** followed by **Swayamwaar Mangal** in another route. This supports the spelling aliases and nearby venue relationship. The same chart lists **Chhatrapati Chowk** separately at the start of route N-1. Therefore Chhatrapati Chowk is retained as an address/locality reference and **is not added as an alias** for Zenda Chowk.

The [public Trip.com Swayamvar Mangal Karyalaya listing](https://in.trip.com/travel-guide/attraction/nanded/swayamvar-mangal-karyalaya-141792177/) gives its locality as Ashtvinayak Nagar, Taroda Kh., with plus code 57RV+F44. This corroborates the Taroda Khurd setting. It is a nearby public venue, not the coordinate used for the junction.

Taroda Kh. is normalized to **Taroda Khurd**. It is not Taroda Budruk. No private address, resident name or contact detail is included in the record.

## Implementation scope

`spawn-location.json` is a single researched place object. It has not been merged into the existing 128-place research snapshots by this research task. If added to the generated city catalogue, it raises the sourced-place total to 129 and the mapped-coordinate total to 64, with the 65 area-level placements unchanged. Update generated coverage counts after the actual merge; do not change only the documentation numbers.
