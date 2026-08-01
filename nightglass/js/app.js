// NightGlass UI. Everything is computed on this device; there is no network
// code in this app — the only URLs anywhere are the service worker's list of
// our own local files.
import {
  julianDate, dateFromJD, sunPosition, moonPosition, moonIllumination,
  moonPhaseName, planetPosition, altAz, riseSet, darknessIntervals,
  belowIntervals, intersectIntervals, PLANET_NAMES,
} from "./astro.js";
import { SkyMap } from "./skymap.js";

const $ = (id) => document.getElementById(id);
const STORE_KEY = "nightglass.location";
const MODE_KEY = "nightglass.mode";

const state = {
  location: loadLocation(),
  mode: localStorage.getItem(MODE_KEY) === "night" ? "night" : "normal",
  offsetMin: 0, // sky-map time offset from now
};

function loadLocation() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const loc = JSON.parse(raw);
    if (typeof loc.lat === "number" && typeof loc.lon === "number") return loc;
  } catch { /* fall through */ }
  return null;
}

function saveLocation(loc) {
  state.location = loc;
  localStorage.setItem(STORE_KEY, JSON.stringify(loc));
}

// ------------------------------------------------------------- formatting

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const fmtTime = (jd) => timeFmt.format(dateFromJD(jd));

function fmtDuration(jdSpan) {
  const min = Math.round(jdSpan * 1440);
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h} h ${m ? m + " min" : ""}`.trim() : `${m} min`;
}

const WINDS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S",
  "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const compass = (az) => WINDS[Math.round(az / 22.5) % 16];

// ------------------------------------------------------------- tonight

// The "night" runs from the most recent solar noon AT THE CAMPSITE to the
// next one, so it always brackets one full night there — independent of the
// timezone this device happens to be set to. In solar time (jd + lon/360),
// integer JDs are exactly local solar noon.
function nightWindow(lon, now = new Date()) {
  const jdSolarNoon = Math.floor(julianDate(now) + lon / 360);
  const jd0 = jdSolarNoon - lon / 360;
  return { jd0, jd1: jd0 + 1 };
}

function computeTonight(lat, lon) {
  const { jd0, jd1 } = nightWindow(lon);
  const sunEvents = riseSet("sun", jd0, jd1, lat, lon);
  const sunset = sunEvents.find((e) => !e.rising)?.jd ?? null;
  const sunrise = sunEvents.find((e) => e.rising && (!sunset || e.jd > sunset))?.jd ?? null;

  // Deepest available darkness: astronomical, else nautical, else civil.
  let darkKind = "astronomical";
  let dark = darknessIntervals(jd0, jd1, 18, lat, lon);
  if (!dark.length) { darkKind = "nautical"; dark = darknessIntervals(jd0, jd1, 12, lat, lon); }
  if (!dark.length) { darkKind = "civil"; dark = darknessIntervals(jd0, jd1, 6, lat, lon); }

  const moonEvents = riseSet("moon", jd0, jd1, lat, lon);
  const moonDown = belowIntervals("moon", jd0, jd1, -0.5667, lat, lon);
  const best = intersectIntervals(dark, moonDown)
    .sort((a, b) => (b.end - b.start) - (a.end - a.start))[0] ?? null;

  const midJd = sunset && sunrise ? (sunset + sunrise) / 2 : jd0 + 0.5;
  const illum = moonIllumination(midJd);

  return {
    jd0, jd1, sunset, sunrise, darkKind, dark, moonEvents, best,
    moonFraction: illum.fraction,
    moonPhase: moonPhaseName(illum.fraction, illum.waxing),
  };
}

function renderTonight(t, lat, lon) {
  $("sunset-time").textContent = t.sunset ? fmtTime(t.sunset) : "—";
  $("sunrise-time").textContent = t.sunrise ? fmtTime(t.sunrise) : "—";

  const darkEl = $("dark-time");
  if (t.dark.length) {
    darkEl.textContent = `${fmtTime(t.dark[0].start)} – ${fmtTime(t.dark[0].end)}`;
    $("dark-label").textContent =
      t.darkKind === "astronomical" ? "True darkness" : `Darkest (${t.darkKind} twilight)`;
  } else {
    darkEl.textContent = "no darkness";
    $("dark-label").textContent = "Midnight sun season";
  }

  const rise = t.moonEvents.find((e) => e.rising);
  const set = t.moonEvents.find((e) => !e.rising);
  const parts = [];
  if (rise) parts.push(`rises ${fmtTime(rise.jd)}`);
  if (set) parts.push(`sets ${fmtTime(set.jd)}`);
  $("moon-times").textContent = parts.length ? parts.join(", ") : "in the sky all night or not at all";
  $("moon-phase").textContent = `${t.moonPhase} · ${Math.round(t.moonFraction * 100)}% lit`;
  $("moon-icon").style.setProperty("--lit", String(t.moonFraction));

  const bestEl = $("best-window");
  if (t.best) {
    const span = t.best.end - t.best.start;
    bestEl.innerHTML =
      `<strong>Best stargazing: ${fmtTime(t.best.start)} – ${fmtTime(t.best.end)}</strong>` +
      `<span>${fmtDuration(span)} of ${t.darkKind === "astronomical" ? "moon-free true darkness" : "moon-free darkness"}</span>`;
  } else if (t.dark.length) {
    bestEl.innerHTML =
      `<strong>Moon is up during dark hours</strong>` +
      `<span>Darkest stretch: ${fmtTime(t.dark[0].start)} – ${fmtTime(t.dark[0].end)} (moonlight will wash out faint stars)</span>`;
  } else {
    bestEl.innerHTML =
      `<strong>No real darkness tonight</strong>` +
      `<span>The sun stays close to the horizon at this latitude right now.</span>`;
  }

  $("location-chip").textContent =
    state.location.name || `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`;
}

// ------------------------------------------------------------- planets

function renderPlanets(t, lat, lon) {
  const list = $("planet-list");
  list.innerHTML = "";
  // "Visible" = above 5 deg altitude while the sun is below -6 deg.
  const duskDark = darknessIntervals(t.jd0, t.jd1, 6, lat, lon);
  let anyVisible = false;
  for (const name of PLANET_NAMES) {
    const up = belowIntervals(name, t.jd0, t.jd1, 5, lat, lon);
    // belowIntervals gives "below 5 deg"; invert within the window.
    const above = [];
    let cursor = t.jd0;
    for (const iv of up) {
      if (iv.start > cursor) above.push({ start: cursor, end: iv.start });
      cursor = iv.end;
    }
    if (cursor < t.jd1) above.push({ start: cursor, end: t.jd1 });

    const visible = intersectIntervals(above, duskDark)
      .filter((iv) => iv.end - iv.start > 20 / 1440)
      .sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];

    const li = document.createElement("li");
    if (visible) {
      anyVisible = true;
      // Direction at the middle of the visible stretch.
      const midJd = (visible.start + visible.end) / 2;
      const p = planetPosition(name, midJd);
      const { alt, az } = altAz(p.ra, p.dec, midJd, lat, lon);
      li.innerHTML = `<strong>${name}</strong> ${fmtTime(visible.start)} – ${fmtTime(visible.end)}, ` +
        `look ${compass(az)}, ${Math.round(alt)}° up`;
    } else {
      li.className = "not-visible";
      li.innerHTML = `<strong>${name}</strong> not visible tonight`;
    }
    list.appendChild(li);
  }
  $("planets-note").hidden = anyVisible;
}

// ------------------------------------------------------------- sky map

const skymap = new SkyMap($("skymap"));

function renderMap() {
  if (!state.location) return;
  const { lat, lon } = state.location;
  const jd = julianDate(new Date()) + state.offsetMin / 1440;
  const bodies = PLANET_NAMES.map((name) => {
    const p = planetPosition(name, jd);
    return { name, ra: p.ra, dec: p.dec, kind: "planet" };
  });
  const m = moonPosition(jd);
  const illum = moonIllumination(jd);
  bodies.push({ name: "Moon", ra: m.ra, dec: m.dec, kind: "moon", moonFraction: illum.fraction });
  skymap.draw({ jd, lat, lon, mode: state.mode, bodies });

  const shown = dateFromJD(jd);
  $("map-time").textContent = state.offsetMin === 0
    ? "Now"
    : timeFmt.format(shown) + (shown.getDate() !== new Date().getDate() ? " (tomorrow)" : "");
}

// ------------------------------------------------------------- wiring

function refresh() {
  if (!state.location) {
    $("setup").hidden = false;
    $("content").hidden = true;
    return;
  }
  $("setup").hidden = true;
  $("content").hidden = false;
  const { lat, lon } = state.location;
  const t = computeTonight(lat, lon);
  renderTonight(t, lat, lon);
  renderPlanets(t, lat, lon);
  renderMap();
}

function applyMode() {
  document.body.classList.toggle("night", state.mode === "night");
  $("mode-toggle").setAttribute("aria-pressed", String(state.mode === "night"));
  renderMap();
}

$("mode-toggle").addEventListener("click", () => {
  state.mode = state.mode === "night" ? "normal" : "night";
  localStorage.setItem(MODE_KEY, state.mode);
  applyMode();
});

$("use-gps").addEventListener("click", () => {
  const status = $("setup-status");
  status.textContent = "Locating…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      // Rounded to ~1 km — plenty for astronomy, and less precise to store.
      saveLocation({
        lat: Math.round(pos.coords.latitude * 100) / 100,
        lon: Math.round(pos.coords.longitude * 100) / 100,
      });
      status.textContent = "";
      refresh();
    },
    () => { status.textContent = "Couldn’t get a fix — enter coordinates below."; },
    { timeout: 15000 }
  );
});

$("manual-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const lat = parseFloat($("lat-input").value);
  const lon = parseFloat($("lon-input").value);
  if (Number.isFinite(lat) && Number.isFinite(lon) &&
      Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    saveLocation({ lat, lon, name: $("name-input").value.trim() || undefined });
    refresh();
  } else {
    $("setup-status").textContent = "Latitude must be −90…90, longitude −180…180.";
  }
});

$("location-chip").addEventListener("click", () => {
  $("setup").hidden = false;
  $("content").hidden = true;
  if (state.location) {
    $("lat-input").value = state.location.lat;
    $("lon-input").value = state.location.lon;
    $("name-input").value = state.location.name || "";
  }
});

$("time-slider").addEventListener("input", (e) => {
  state.offsetMin = Number(e.target.value);
  renderMap();
});

$("time-now").addEventListener("click", () => {
  state.offsetMin = 0;
  $("time-slider").value = "0";
  renderMap();
});

window.addEventListener("resize", renderMap);

// Keep "tonight" fresh if the app stays open at the campsite.
setInterval(refresh, 5 * 60 * 1000);

// Auto-suggest night mode after sunset on first visit this session.
if (!localStorage.getItem(MODE_KEY) && state.location) {
  const s = sunPosition(julianDate(new Date()));
  const { alt } = altAz(s.ra, s.dec, julianDate(new Date()),
    state.location.lat, state.location.lon);
  if (alt < -6) state.mode = "night";
}

applyMode();
refresh();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}
