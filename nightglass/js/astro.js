// NightGlass ephemeris engine — pure functions, no I/O, no network.
//
// Algorithms: Jean Meeus, "Astronomical Algorithms" 2nd ed. (sun ch.25,
// moon ch.47 truncated series, phase ch.48, sidereal time ch.12) and
// Paul Schlyter's "How to compute planetary positions" (planet orbital
// elements with linear rates). Accuracy is ample for naked-eye stargazing:
// sun ~0.01 deg, moon ~0.05 deg, planets a few arcminutes (Jupiter/Saturn
// within ~0.1 deg with the mutual perturbation terms included).
// Validated against the astronomy-engine library in test/astro.test.mjs.

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

const sin = (d) => Math.sin(d * DEG);
const cos = (d) => Math.cos(d * DEG);

export function norm360(d) {
  return ((d % 360) + 360) % 360;
}

// ---------------------------------------------------------------- time

export function julianDate(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

export function dateFromJD(jd) {
  return new Date((jd - 2440587.5) * 86400000);
}

// Greenwich mean sidereal time in degrees (Meeus 12.4).
export function gmst(jd) {
  const T = (jd - 2451545.0) / 36525;
  return norm360(
    280.46061837 + 360.98564736629 * (jd - 2451545.0) +
    0.000387933 * T * T - (T * T * T) / 38710000
  );
}

// Local sidereal time in degrees; longitude east-positive.
export function lst(jd, lonDeg) {
  return norm360(gmst(jd) + lonDeg);
}

function obliquity(T) {
  return 23.43929111 - 0.01300417 * T - 1.64e-7 * T * T;
}

// ---------------------------------------------------------------- frames

function eclToEqu(lonDeg, latDeg, eps) {
  const ra = Math.atan2(
    sin(lonDeg) * cos(eps) - Math.tan(latDeg * DEG) * sin(eps),
    cos(lonDeg)
  ) * RAD;
  const dec = Math.asin(
    sin(latDeg) * cos(eps) + cos(latDeg) * sin(eps) * sin(lonDeg)
  ) * RAD;
  return { ra: norm360(ra), dec };
}

// Equatorial (ra/dec deg) to horizontal (alt/az deg, az from North through East).
export function altAz(raDeg, decDeg, jd, latDeg, lonDeg) {
  const H = lst(jd, lonDeg) - raDeg; // hour angle, degrees
  const alt = Math.asin(
    sin(latDeg) * sin(decDeg) + cos(latDeg) * cos(decDeg) * cos(H)
  ) * RAD;
  const az = norm360(
    Math.atan2(sin(H), cos(H) * sin(latDeg) - Math.tan(decDeg * DEG) * cos(latDeg)) * RAD + 180
  );
  return { alt, az };
}

// ---------------------------------------------------------------- sun

// Geocentric apparent RA/Dec of the Sun (Meeus ch.25 "low accuracy", ~0.01 deg).
export function sunPosition(jd) {
  const T = (jd - 2451545.0) / 36525;
  const L0 = norm360(280.46646 + 36000.76983 * T + 0.0003032 * T * T);
  const M = norm360(357.52911 + 35999.05029 * T - 0.0001537 * T * T);
  const e = 0.016708634 - 0.000042037 * T;
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * sin(M) +
    (0.019993 - 0.000101 * T) * sin(2 * M) +
    0.000289 * sin(3 * M);
  const trueLon = L0 + C;
  const nu = M + C;
  const R = (1.000001018 * (1 - e * e)) / (1 + e * cos(nu)); // AU
  const Om = 125.04 - 1934.136 * T;
  const lambda = trueLon - 0.00569 - 0.00478 * sin(Om); // apparent
  const eps = obliquity(T) + 0.00256 * cos(Om);
  const { ra, dec } = eclToEqu(lambda, 0, eps);
  return { ra, dec, dist: R, eclLon: norm360(lambda) };
}

// ---------------------------------------------------------------- moon

// Meeus ch.47, truncated to the dominant periodic terms.
// Rows: [D, M, Mp, F, coefficient]; lon/dist coefficients share arguments.
const MOON_LR = [
  [0, 0, 1, 0, 6288774, -20905355],
  [2, 0, -1, 0, 1274027, -3699111],
  [2, 0, 0, 0, 658314, -2955968],
  [0, 0, 2, 0, 213618, -569925],
  [0, 1, 0, 0, -185116, 48888],
  [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158],
  [2, -1, -1, 0, 57066, -152138],
  [2, 0, 1, 0, 53322, -170733],
  [2, -1, 0, 0, 45758, -204586],
  [0, 1, -1, 0, -40923, -129620],
  [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755],
  [2, 0, 0, -2, 15327, 10321],
  [0, 0, 1, 2, -12528, 0],
  [0, 0, 1, -2, 10980, 79661],
  [4, 0, -1, 0, 10675, -34782],
  [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636],
  [2, 1, -1, 0, -7888, 24208],
  [2, 1, 0, 0, -6766, 30824],
  [1, 0, -1, 0, -5163, -8379],
  [1, 1, 0, 0, 4987, -16675],
  [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445],
  [4, 0, 0, 0, 3861, -11650],
  [2, 0, -3, 0, 3665, 14403],
  [0, 1, -2, 0, -2689, -7003],
  [2, 0, -1, 2, -2602, 0],
  [2, -1, -2, 0, 2390, 10056],
];

// Rows: [D, M, Mp, F, coefficient] for latitude.
const MOON_B = [
  [0, 0, 0, 1, 5128122],
  [0, 0, 1, 1, 280602],
  [0, 0, 1, -1, 277693],
  [2, 0, 0, -1, 173237],
  [2, 0, -1, 1, 55413],
  [2, 0, -1, -1, 46271],
  [2, 0, 0, 1, 32573],
  [0, 0, 2, 1, 17198],
  [2, 0, 1, -1, 9266],
  [0, 0, 2, -1, 8822],
  [2, -1, 0, -1, 8216],
  [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200],
  [2, 1, 0, -1, -3359],
  [2, -1, -1, 1, 2463],
  [2, -1, 0, 1, 2211],
  [2, -1, -1, -1, 2065],
  [0, 1, -1, -1, -1870],
];

// Geocentric RA/Dec of the Moon plus distance (km) and horizontal parallax (deg).
export function moonPosition(jd) {
  const T = (jd - 2451545.0) / 36525;
  const Lp = norm360(218.3164477 + 481267.88123421 * T - 0.0015786 * T * T + (T * T * T) / 538841);
  const D = norm360(297.8501921 + 445267.1114034 * T - 0.0018819 * T * T + (T * T * T) / 545868);
  const M = norm360(357.5291092 + 35999.0502909 * T - 0.0001536 * T * T);
  const Mp = norm360(134.9633964 + 477198.8675055 * T + 0.0087414 * T * T + (T * T * T) / 69699);
  const F = norm360(93.272095 + 483202.0175233 * T - 0.0036539 * T * T - (T * T * T) / 3526000);
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;

  let sumL = 0, sumR = 0, sumB = 0;
  for (const [d, m, mp, f, cl, cr] of MOON_LR) {
    const eFac = m === 0 ? 1 : (Math.abs(m) === 1 ? E : E * E);
    const arg = d * D + m * M + mp * Mp + f * F;
    sumL += cl * eFac * sin(arg);
    sumR += cr * eFac * cos(arg);
  }
  for (const [d, m, mp, f, cb] of MOON_B) {
    const eFac = m === 0 ? 1 : (Math.abs(m) === 1 ? E : E * E);
    sumB += cb * eFac * sin(d * D + m * M + mp * Mp + f * F);
  }
  // The largest additive corrections (Meeus p. 342).
  const A1 = norm360(119.75 + 131.849 * T);
  const A2 = norm360(53.09 + 479264.29 * T);
  const A3 = norm360(313.45 + 481266.484 * T);
  sumL += 3958 * sin(A1) + 1962 * sin(Lp - F) + 318 * sin(A2);
  sumB += -2235 * sin(Lp) + 382 * sin(A3) + 175 * sin(A1 - F) +
    175 * sin(A1 + F) + 127 * sin(Lp - Mp) - 115 * sin(Lp + Mp);

  const lon = norm360(Lp + sumL / 1e6);
  const lat = sumB / 1e6;
  const dist = 385000.56 + sumR / 1000; // km
  const eps = obliquity(T);
  const { ra, dec } = eclToEqu(lon, lat, eps);
  const parallax = Math.asin(6378.14 / dist) * RAD;
  return { ra, dec, dist, parallax, eclLon: lon, eclLat: lat };
}

// Illuminated fraction, phase angle, and a waxing flag (Meeus ch.48).
export function moonIllumination(jd) {
  const s = sunPosition(jd);
  const m = moonPosition(jd);
  const cosPsi = sin(s.dec) * sin(m.dec) + cos(s.dec) * cos(m.dec) * cos(s.ra - m.ra);
  const psi = Math.acos(Math.min(1, Math.max(-1, cosPsi))); // elongation, radians
  const sunDistKm = s.dist * 149597870.7;
  const i = Math.atan2(sunDistKm * Math.sin(psi), m.dist - sunDistKm * Math.cos(psi));
  const fraction = (1 + Math.cos(i)) / 2;
  const waxing = norm360(m.eclLon - s.eclLon) < 180;
  return { fraction, phaseAngle: i * RAD, waxing };
}

export function moonPhaseName(fraction, waxing) {
  if (fraction < 0.03) return "New Moon";
  if (fraction > 0.97) return "Full Moon";
  if (Math.abs(fraction - 0.5) < 0.03) return waxing ? "First Quarter" : "Last Quarter";
  if (fraction < 0.5) return waxing ? "Waxing Crescent" : "Waning Crescent";
  return waxing ? "Waxing Gibbous" : "Waning Gibbous";
}

// ---------------------------------------------------------------- planets

// Orbital elements at epoch, with per-day linear rates (Paul Schlyter).
// d = jd - 2451543.5. Angles in degrees, a in AU.
const PLANET_ELEMENTS = {
  Mercury: { N: [48.3313, 3.24587e-5], i: [7.0047, 5.0e-8], w: [29.1241, 1.01444e-5], a: [0.387098, 0], e: [0.205635, 5.59e-10], M: [168.6562, 4.0923344368] },
  Venus: { N: [76.6799, 2.4659e-5], i: [3.3946, 2.75e-8], w: [54.891, 1.38374e-5], a: [0.72333, 0], e: [0.006773, -1.302e-9], M: [48.0052, 1.6021302244] },
  Mars: { N: [49.5574, 2.11081e-5], i: [1.8497, -1.78e-8], w: [286.5016, 2.92961e-5], a: [1.523688, 0], e: [0.093405, 2.516e-9], M: [18.6021, 0.5240207766] },
  Jupiter: { N: [100.4542, 2.76854e-5], i: [1.303, -1.557e-7], w: [273.8777, 1.64505e-5], a: [5.20256, 0], e: [0.048498, 4.469e-9], M: [19.895, 0.0830853001] },
  Saturn: { N: [113.6634, 2.3898e-5], i: [2.4886, -1.081e-7], w: [339.3939, 2.97661e-5], a: [9.55475, 0], e: [0.055546, -9.499e-9], M: [316.967, 0.0334442282] },
};

export const PLANET_NAMES = Object.keys(PLANET_ELEMENTS);

function keplerE(M, e) {
  let E = M + e * RAD * sin(M) * (1 + e * cos(M));
  for (let k = 0; k < 10; k++) {
    const dE = (E - e * RAD * sin(E) - M) / (1 - e * cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-8) break;
  }
  return E;
}

// Heliocentric ecliptic rectangular coordinates (AU) of a body from elements.
function helioXYZ(el, d) {
  const N = el.N[0] + el.N[1] * d;
  const i = el.i[0] + el.i[1] * d;
  const w = el.w[0] + el.w[1] * d;
  const a = el.a[0];
  const e = el.e[0] + el.e[1] * d;
  const M = norm360(el.M[0] + el.M[1] * d);
  const E = keplerE(M, e);
  const xv = a * (cos(E) - e);
  const yv = a * Math.sqrt(1 - e * e) * sin(E);
  const v = Math.atan2(yv, xv) * RAD;
  const r = Math.sqrt(xv * xv + yv * yv);
  const u = v + w; // argument of latitude
  return {
    x: r * (cos(N) * cos(u) - sin(N) * sin(u) * cos(i)),
    y: r * (sin(N) * cos(u) + cos(N) * sin(u) * cos(i)),
    z: r * sin(u) * sin(i),
    M,
  };
}

// Geocentric apparent RA/Dec of a naked-eye planet.
export function planetPosition(name, jd) {
  const d = jd - 2451543.5;
  const el = PLANET_ELEMENTS[name];
  const p = helioXYZ(el, d);

  // Mutual Jupiter/Saturn perturbations (Schlyter) — the only ones that matter
  // at naked-eye accuracy.
  let lonCorr = 0, latCorr = 0;
  if (name === "Jupiter" || name === "Saturn") {
    const Mj = norm360(PLANET_ELEMENTS.Jupiter.M[0] + PLANET_ELEMENTS.Jupiter.M[1] * d);
    const Ms = norm360(PLANET_ELEMENTS.Saturn.M[0] + PLANET_ELEMENTS.Saturn.M[1] * d);
    if (name === "Jupiter") {
      lonCorr =
        -0.332 * sin(2 * Mj - 5 * Ms - 67.6) -
        0.056 * sin(2 * Mj - 2 * Ms + 21) +
        0.042 * sin(3 * Mj - 5 * Ms + 21) -
        0.036 * sin(Mj - 2 * Ms) +
        0.022 * cos(Mj - Ms) +
        0.023 * sin(2 * Mj - 3 * Ms + 52) -
        0.016 * sin(Mj - 5 * Ms - 69);
    } else {
      lonCorr =
        0.812 * sin(2 * Mj - 5 * Ms - 67.6) -
        0.229 * cos(2 * Mj - 4 * Ms - 2) +
        0.119 * sin(Mj - 2 * Ms - 3) +
        0.046 * sin(2 * Mj - 6 * Ms - 69) +
        0.014 * sin(Mj - 3 * Ms + 32);
      latCorr =
        -0.02 * cos(2 * Mj - 4 * Ms - 2) +
        0.018 * sin(2 * Mj - 6 * Ms - 49);
    }
    const lon = Math.atan2(p.y, p.x) * RAD + lonCorr;
    const rxy = Math.sqrt(p.x * p.x + p.y * p.y);
    const lat = Math.atan2(p.z, rxy) * RAD + latCorr;
    const r = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
    p.x = r * cos(lon) * cos(lat);
    p.y = r * sin(lon) * cos(lat);
    p.z = r * sin(lat);
  }

  // Sun's geocentric ecliptic position (Schlyter's simplified sun orbit).
  const ws = 282.9404 + 4.70935e-5 * d;
  const es = 0.016709 - 1.151e-9 * d;
  const Msun = norm360(356.047 + 0.9856002585 * d);
  const Es = keplerE(Msun, es);
  const xs = cos(Es) - es;
  const ys = Math.sqrt(1 - es * es) * sin(Es);
  const rs = Math.sqrt(xs * xs + ys * ys);
  const lonSun = norm360(Math.atan2(ys, xs) * RAD + ws);
  const sx = rs * cos(lonSun);
  const sy = rs * sin(lonSun);

  const gx = p.x + sx;
  const gy = p.y + sy;
  const gz = p.z;
  const lon = norm360(Math.atan2(gy, gx) * RAD);
  const lat = Math.atan2(gz, Math.sqrt(gx * gx + gy * gy)) * RAD;
  const dist = Math.sqrt(gx * gx + gy * gy + gz * gz);
  const T = (jd - 2451545.0) / 36525;
  const { ra, dec } = eclToEqu(lon, lat, obliquity(T));
  return { ra, dec, dist };
}

// ---------------------------------------------------------------- events

// Altitude of a body above the horizon at jd, for rise/set purposes.
// For the moon, uses topocentric altitude (parallax matters: ~1 deg).
function bodyAlt(body, jd, lat, lon) {
  if (body === "sun") {
    const s = sunPosition(jd);
    return altAz(s.ra, s.dec, jd, lat, lon).alt;
  }
  if (body === "moon") {
    // Topocentric altitude of the upper limb: parallax lowers the moon,
    // its semidiameter (0.2725 * parallax) raises the limb above the center.
    const m = moonPosition(jd);
    const { alt } = altAz(m.ra, m.dec, jd, lat, lon);
    return alt - m.parallax * cos(alt) + 0.2725 * m.parallax;
  }
  const p = planetPosition(body, jd);
  return altAz(p.ra, p.dec, jd, lat, lon).alt;
}

const H0 = { sun: -0.8333, moon: -0.5667, planet: -0.5667 };

// Find all crossings of `threshold` altitude for `body` in [jdStart, jdEnd].
// Returns [{jd, rising}] sorted by time. Sampling every 6 minutes then
// bisecting is robust at every latitude and fast enough (< 1 ms per night).
export function findCrossings(body, jdStart, jdEnd, threshold, lat, lon) {
  const step = 6 / 1440;
  const out = [];
  let prevJd = jdStart;
  let prevAlt = bodyAlt(body, prevJd, lat, lon) - threshold;
  for (let jd = jdStart + step; jd <= jdEnd + 1e-9; jd += step) {
    const a = bodyAlt(body, jd, lat, lon) - threshold;
    if ((prevAlt <= 0 && a > 0) || (prevAlt > 0 && a <= 0)) {
      let lo = prevJd, hi = jd;
      for (let k = 0; k < 20; k++) {
        const mid = (lo + hi) / 2;
        const am = bodyAlt(body, mid, lat, lon) - threshold;
        if ((prevAlt <= 0) === (am <= 0)) lo = mid; else hi = mid;
      }
      out.push({ jd: (lo + hi) / 2, rising: prevAlt <= 0 });
    }
    prevJd = jd;
    prevAlt = a;
  }
  return out;
}

export function riseSet(body, jdStart, jdEnd, lat, lon) {
  const h0 = H0[body] ?? H0.planet;
  return findCrossings(body, jdStart, jdEnd, h0, lat, lon);
}

// Sun-below-`depressionDeg` intervals within [jdStart, jdEnd] — twilight math.
export function darknessIntervals(jdStart, jdEnd, depressionDeg, lat, lon) {
  return belowIntervals("sun", jdStart, jdEnd, -depressionDeg, lat, lon);
}

// Intervals [{start, end}] (JDs) where body altitude < threshold.
export function belowIntervals(body, jdStart, jdEnd, threshold, lat, lon) {
  const crossings = findCrossings(body, jdStart, jdEnd, threshold, lat, lon);
  const below0 = bodyAlt(body, jdStart, lat, lon) < threshold;
  const intervals = [];
  let start = below0 ? jdStart : null;
  for (const c of crossings) {
    if (c.rising) {
      if (start !== null) intervals.push({ start, end: c.jd });
      start = null;
    } else {
      start = c.jd;
    }
  }
  if (start !== null) intervals.push({ start, end: jdEnd });
  return intervals;
}

// Intersect two sorted interval lists.
export function intersectIntervals(a, b) {
  const out = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i].start, b[j].start);
    const end = Math.min(a[i].end, b[j].end);
    if (start < end) out.push({ start, end });
    if (a[i].end < b[j].end) i++; else j++;
  }
  return out;
}
