// Full-sky chart on a <canvas>: stereographic projection of the hemisphere
// above the horizon, zenith at center, North up, East to the LEFT — the
// planisphere convention, correct when you hold the screen overhead.
import { STARS, CONSTELLATIONS } from "./data.js";
import { altAz, lst } from "./astro.js";

const DEG = Math.PI / 180;

const PALETTES = {
  normal: {
    sky: "#0d1224",
    horizonRing: "#3d4a6b",
    grid: "rgba(90,105,150,0.25)",
    cardinal: "#8fa0c9",
    star: "#f2f4ff",
    starName: "#c9d3f2",
    constellation: "rgba(110,140,205,0.55)",
    constellationName: "rgba(150,170,220,0.75)",
    moonDisk: "#e8e4d8",
    moonDark: "#3a3f52",
    planet: "#ffd9a0",
    planetName: "#ffcf8a",
    edgeFade: "#070a15",
  },
  night: {
    sky: "#0a0000",
    horizonRing: "#5c1010",
    grid: "rgba(140,20,20,0.30)",
    cardinal: "#b03030",
    star: "#ff6b6b",
    starName: "#c04848",
    constellation: "rgba(160,40,40,0.55)",
    constellationName: "rgba(170,60,60,0.75)",
    moonDisk: "#d05050",
    moonDark: "#300808",
    planet: "#ff8a5c",
    planetName: "#e07040",
    edgeFade: "#050000",
  },
};

// alt/az (deg) -> unit-disk x,y. Returns null below the clip altitude.
function project(alt, az, clipAlt = -0.5) {
  if (alt < clipAlt) return null;
  const z = (90 - Math.max(alt, clipAlt)) * DEG;
  const r = Math.tan(z / 2) / Math.tan(Math.PI / 4);
  return { x: -r * Math.sin(az * DEG), y: -r * Math.cos(az * DEG) };
}

export class SkyMap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
  }

  // bodies: [{name, ra, dec, kind: "planet"|"moon", moonFraction?}]
  draw({ jd, lat, lon, mode = "normal", bodies = [] }) {
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssSize = c.clientWidth;
    if (cssSize === 0) return; // hidden or not laid out yet
    if (c.width !== cssSize * dpr) {
      c.width = cssSize * dpr;
      c.height = cssSize * dpr;
    }
    const ctx = this.ctx;
    const P = PALETTES[mode];
    const W = c.width;
    const R = W / 2 - 14 * dpr; // sky radius, padding for cardinal labels
    const cx = W / 2, cy = W / 2;
    const localSidereal = lst(jd, lon);

    const toXY = (ra, dec) => {
      const H = localSidereal - ra;
      const sinAlt = Math.sin(lat * DEG) * Math.sin(dec * DEG) +
        Math.cos(lat * DEG) * Math.cos(dec * DEG) * Math.cos(H * DEG);
      const alt = Math.asin(sinAlt) / DEG;
      const az = (Math.atan2(
        Math.sin(H * DEG),
        Math.cos(H * DEG) * Math.sin(lat * DEG) - Math.tan(dec * DEG) * Math.cos(lat * DEG)
      ) / DEG + 180 + 360) % 360;
      const p = project(alt, az);
      return p ? { x: cx + p.x * R, y: cy + p.y * R, alt } : null;
    };

    ctx.clearRect(0, 0, W, W);

    // Sky disk.
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    const grad = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R);
    grad.addColorStop(0, P.sky);
    grad.addColorStop(1, P.edgeFade);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.clip();

    // Altitude circles at 30 and 60 degrees.
    ctx.strokeStyle = P.grid;
    ctx.lineWidth = dpr;
    for (const alt of [30, 60]) {
      const r = (Math.tan(((90 - alt) * DEG) / 2) / Math.tan(Math.PI / 4)) * R;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Constellation lines.
    ctx.strokeStyle = P.constellation;
    ctx.lineWidth = dpr;
    for (const con of CONSTELLATIONS) {
      for (const seg of con.lines) {
        let prev = null;
        for (const [ra, dec] of seg) {
          const pt = toXY(ra, dec);
          if (prev && pt) {
            ctx.beginPath();
            ctx.moveTo(prev.x, prev.y);
            ctx.lineTo(pt.x, pt.y);
            ctx.stroke();
          }
          prev = pt;
        }
      }
    }

    // Constellation names for the prominent ones, when high enough to see.
    ctx.fillStyle = P.constellationName;
    ctx.font = `${10 * dpr}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    for (const con of CONSTELLATIONS) {
      if (con.rank > 2) continue;
      const pt = toXY(con.label[0], con.label[1]);
      if (pt && pt.alt > 12) ctx.fillText(con.name, pt.x, pt.y);
    }

    // Stars, brightest first (data is pre-sorted by magnitude).
    for (const s of STARS) {
      const pt = toXY(s[0], s[1]);
      if (!pt) continue;
      const mag = s[2];
      const size = Math.max(0.6, 3.2 - mag * 0.55) * dpr;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, size, 0, Math.PI * 2);
      ctx.fillStyle = P.star;
      ctx.globalAlpha = mag <= 1 ? 1 : Math.max(0.35, 1 - (mag - 1) * 0.14);
      ctx.fill();
      if (s[3] && pt.alt > 5) {
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = P.starName;
        ctx.font = `${9 * dpr}px system-ui, sans-serif`;
        ctx.fillText(s[3], pt.x, pt.y - 6 * dpr);
        ctx.fillStyle = P.star;
      }
    }
    ctx.globalAlpha = 1;

    // Planets and the moon.
    for (const b of bodies) {
      const pt = toXY(b.ra, b.dec);
      if (!pt) continue;
      if (b.kind === "moon") {
        const r = 7 * dpr;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
        ctx.fillStyle = P.moonDisk;
        ctx.fill();
        // Phase hint: shade the un-lit fraction from one side.
        const f = b.moonFraction ?? 1;
        if (f < 0.97) {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
          ctx.fillStyle = P.moonDark;
          ctx.globalAlpha = 1 - f;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = P.planetName;
        ctx.font = `bold ${10 * dpr}px system-ui, sans-serif`;
        ctx.fillText("Moon", pt.x, pt.y - 10 * dpr);
      } else {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 3.4 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = P.planet;
        ctx.fill();
        ctx.fillStyle = P.planetName;
        ctx.font = `bold ${10 * dpr}px system-ui, sans-serif`;
        ctx.fillText(b.name, pt.x, pt.y - 7 * dpr);
      }
    }
    ctx.restore();

    // Horizon ring + cardinal points (E left: you are looking UP).
    ctx.strokeStyle = P.horizonRing;
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = P.cardinal;
    ctx.font = `bold ${12 * dpr}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const off = 7 * dpr;
    ctx.fillText("N", cx, cy - R - off);
    ctx.fillText("S", cx, cy + R + off);
    ctx.fillText("E", cx - R - off, cy);
    ctx.fillText("W", cx + R + off, cy);
    ctx.textBaseline = "alphabetic";
  }
}
