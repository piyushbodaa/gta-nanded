// Vehicle catalogue: dimensions (metres), handling and the colours they come in.
// Local frame: +z forward, +y up, origin on the ground under the centre.
//
// Handling numbers are for fun, not a spec sheet: accel is m/s^2 off the line,
// top in m/s (x3.6 for the HUD's km/h), grip is the tyre friction coefficient.
export const VEHICLE_TYPES = {
  hatch: {
    name: 'Deccan Sprint', mr: 'हॅचबॅक', L: 3.85, W: 1.7, H: 1.5, wheelbase: 2.43, wheelR: 0.3, track: 1.46,
    mass: 950, accel: 5.6, top: 41, reverseTop: 9, brake: 11, grip: 1.05, steerLock: 0.62, seats: 4, drive: 'front',
    colors: [0xd62f2f, 0xf2f2f2, 0x9aa3a8, 0x1f3a93, 0x2b2b2b, 0xe8a33d, 0x2e7d32, 0x8e1b1b],
  },
  sedan: {
    name: 'Marathwada Sedan', mr: 'सेडान', L: 4.25, W: 1.72, H: 1.46, wheelbase: 2.55, wheelR: 0.31, track: 1.48,
    mass: 1120, accel: 5.0, top: 43, reverseTop: 9, brake: 10.5, grip: 1.0, steerLock: 0.58, seats: 4, drive: 'front',
    colors: [0xf2f2f2, 0xc0c0c0, 0x1b2631, 0x7b241c, 0xe8e2d0, 0x34495e],
  },
  suv: {
    name: 'Sahyadri SUV', mr: 'एसयूव्ही', L: 4.45, W: 1.84, H: 1.92, wheelbase: 2.68, wheelR: 0.36, track: 1.56,
    mass: 1750, accel: 4.8, top: 40, reverseTop: 8, brake: 10, grip: 0.95, steerLock: 0.55, seats: 6, drive: 'rear',
    colors: [0xf7f7f7, 0x111111, 0x7f8c8d, 0x5d4037],
  },
  police: {
    name: 'Police Jeep', mr: 'पोलीस जीप', L: 4.15, W: 1.76, H: 1.95, wheelbase: 2.68, wheelR: 0.35, track: 1.5,
    mass: 1650, accel: 5.4, top: 42, reverseTop: 9, brake: 11, grip: 1.05, steerLock: 0.58, seats: 6, drive: 'rear',
    colors: [0xf4f4f0],
  },
  auto: {
    name: 'Nanded Auto', mr: 'रिक्षा', L: 2.65, W: 1.32, H: 1.78, wheelbase: 1.95, wheelR: 0.23, track: 1.15,
    mass: 420, accel: 3.6, top: 17, reverseTop: 4, brake: 7, grip: 0.82, steerLock: 0.75, seats: 4, drive: 'rear', three: true,
    colors: [0x1d1d1d, 0x1d1d1d, 0x2f8f4e], canopy: [0xf2c230, 0xf2c230, 0xf2c230],
  },
  bike: {
    name: 'Tejas 125', mr: 'बाईक', L: 2.0, W: 0.72, H: 1.1, wheelbase: 1.27, wheelR: 0.31, track: 0,
    mass: 190, accel: 6.2, top: 31, reverseTop: 2, brake: 11, grip: 1.15, steerLock: 0.7, seats: 2, drive: 'rear', two: true,
    colors: [0xb71c1c, 0x111111, 0x1565c0, 0x6a1b9a, 0xf2f2f2, 0x2e7d32],
  },
  scooter: {
    name: 'Zoom Scooty', mr: 'स्कूटी', L: 1.8, W: 0.7, H: 1.12, wheelbase: 1.25, wheelR: 0.24, track: 0,
    mass: 160, accel: 4.6, top: 23, reverseTop: 2, brake: 10, grip: 1.05, steerLock: 0.75, seats: 2, drive: 'rear', two: true,
    colors: [0xf2f2f2, 0xe53935, 0x1e88e5, 0xfdd835, 0x43a047, 0x8e8e8e],
  },
  bus: {
    name: 'MSRTC Lal Pari', mr: 'लाल परी', L: 10.6, W: 2.5, H: 3.1, wheelbase: 5.8, wheelR: 0.5, track: 2.05,
    mass: 9000, accel: 2.1, top: 22, reverseTop: 5, brake: 6, grip: 0.85, steerLock: 0.5, seats: 40, drive: 'rear',
    colors: [0xc0392b],
  },
  truck: {
    name: 'Deccan Highway Truck', mr: 'ट्रक', L: 7.6, W: 2.4, H: 3.3, wheelbase: 4.4, wheelR: 0.48, track: 1.95,
    mass: 8000, accel: 2.0, top: 24, reverseTop: 5, brake: 6, grip: 0.85, steerLock: 0.5, seats: 2, drive: 'rear',
    colors: [0xf39c12, 0x1e88e5, 0xd84315, 0x2e7d32],
  },
  tractor: {
    name: 'Kisan Tractor', mr: 'ट्रॅक्टर', L: 3.4, W: 1.75, H: 2.3, wheelbase: 2.0, wheelR: 0.7, wheelRF: 0.42, track: 1.45,
    mass: 2400, accel: 2.4, top: 12, reverseTop: 4, brake: 7, grip: 0.95, steerLock: 0.6, seats: 1, drive: 'rear',
    colors: [0xc62828, 0x1565c0, 0x2e7d32],
  },
  tempo: {
    name: 'Mondha Tempo', mr: 'टेम्पो', L: 3.8, W: 1.55, H: 1.95, wheelbase: 2.25, wheelR: 0.3, track: 1.3,
    mass: 1250, accel: 3.6, top: 25, reverseTop: 6, brake: 8, grip: 0.9, steerLock: 0.62, seats: 2, drive: 'rear',
    colors: [0xf2f2f2, 0x1e88e5, 0xfbc02d, 0x43a047],
  },
  ambulance: {
    name: '108 Ambulance', mr: 'रुग्णवाहिका', L: 4.7, W: 1.82, H: 2.25, wheelbase: 2.9, wheelR: 0.33, track: 1.56,
    mass: 1900, accel: 4.4, top: 38, reverseTop: 8, brake: 10, grip: 0.95, steerLock: 0.56, seats: 3, drive: 'rear',
    colors: [0xfafafa],
  },
};

export const TYPE_KEYS = Object.keys(VEHICLE_TYPES);
