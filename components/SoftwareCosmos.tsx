"use client";

import { useEffect, useRef } from "react";
import type { CosmosSceneProps } from "./CosmosScene";
import type { World, Planet, Society } from "@/lib/simulation";

// A software projection of the same world, used when WebGL is unavailable.
// Terrain is generated once per seed. Subsequent frames only project the atlas.
const TAU = Math.PI * 2;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, n: number) => { const t = clamp((n - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
type Vec = [number, number, number];
type Atlas = { width: number; height: number; colors: Uint8ClampedArray; land: Float32Array; elevation: Float32Array; clouds: Float32Array; regions: Uint8Array; borders: Float32Array; cityLight: Float32Array };
const atlasCache = new Map<string, Atlas>();

function seeded(seed: number) {
  let state = seed >>> 0;
  return () => { state += 0x6d2b79f5; let t = Math.imul(state ^ (state >>> 15), state | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hash(x: number, y: number, z: number, seed: number) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function noise(x: number, y: number, z: number, seed: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  return mix(mix(mix(hash(ix, iy, iz, seed), hash(ix + 1, iy, iz, seed), fx), mix(hash(ix, iy + 1, iz, seed), hash(ix + 1, iy + 1, iz, seed), fx), fy), mix(mix(hash(ix, iy, iz + 1, seed), hash(ix + 1, iy, iz + 1, seed), fx), mix(hash(ix, iy + 1, iz + 1, seed), hash(ix + 1, iy + 1, iz + 1, seed), fx), fy), fz);
}
function fbm(x: number, y: number, z: number, seed: number, octaves = 5) {
  let value = 0, weight = 0.5;
  for (let i = 0; i < octaves; i++) { value += noise(x, y, z, seed) * weight; x = x * 2.03 + 6.7; y = y * 2.03 + 3.1; z = z * 2.03 + 9.2; weight *= 0.49; }
  return value;
}
function rgb(hex: string): Vec {
  const h = hex.replace("#", "");
  const channel = (offset: number) => {
    const value = parseInt(h.slice(offset, offset + 2), 16);
    return Number.isFinite(value) ? value : 100;
  };
  return [channel(0), channel(2), channel(4)];
}
function unit(lat: number, lon: number): Vec {
  const a = lat * Math.PI / 180, b = lon * Math.PI / 180;
  return [Math.cos(a) * Math.sin(b), Math.sin(a), Math.cos(a) * Math.cos(b)];
}

function atlasFor(planet: Planet, societies: Society[]): Atlas {
  const key = `${planet.seed}:${planet.kind}:${planet.water}:${societies.map(s => `${s.id}/${s.lat}/${s.lon}`).join(",")}`;
  const cached = atlasCache.get(key);
  if (cached) return cached;
  const width = 768, height = 384, count = width * height;
  const atlas: Atlas = { width, height, colors: new Uint8ClampedArray(count * 3), land: new Float32Array(count), elevation: new Float32Array(count), clouds: new Float32Array(count), regions: new Uint8Array(count), borders: new Float32Array(count), cityLight: new Float32Array(count) };
  const directions = societies.map(s => unit(s.lat, s.lon));
  const base = rgb(planet.color);
  const seed = planet.seed >>> 0;
  const sea = 0.25 + planet.water * 0.38;
  const cosLong = new Float64Array(width), sinLong = new Float64Array(width);
  for (let x = 0; x < width; x++) { const lon = x / width * TAU - Math.PI; cosLong[x] = Math.cos(lon); sinLong[x] = Math.sin(lon); }
  for (let v = 0; v < height; v++) {
    const lat = Math.PI / 2 - v / (height - 1) * Math.PI;
    const yy = Math.sin(lat), rr = Math.cos(lat), latitude = Math.abs(yy);
    for (let u = 0; u < width; u++) {
      const i = v * width + u, x = rr * sinLong[u], y = yy, z = rr * cosLong[u];
      const warp = noise(x * 3.1, y * 3.1, z * 3.1, seed + 91);
      let elevation = fbm(x * 3.05 + warp, y * 3.05 + warp, z * 3.05 + warp, seed);
      let nearest = -2, second = -2, closest = 0, cityLight = 0;
      for (let j = 0; j < directions.length; j++) {
        const dir = directions[j], proximity = x * dir[0] + y * dir[1] + z * dir[2];
        if (proximity > nearest) { second = nearest; nearest = proximity; closest = j; } else second = Math.max(second, proximity);
        const settlement = smooth(0.975, 0.998, proximity);
        elevation = mix(elevation, Math.max(elevation, sea + 0.025), settlement);
        cityLight += smooth(0.987, 0.9999, proximity);
      }
      const fine = noise(x * 98, y * 98, z * 98, seed + 19);
      const land = smooth(sea - 0.002, sea + 0.012, elevation);
      const shore = smooth(sea - 0.045, sea, elevation);
      const mountain = smooth(sea + 0.085, sea + 0.20, elevation);
      const arid = smooth(0.25, 0.55, latitude) * (1 - smooth(0.6, 0.8, latitude));
      const ice = smooth(0.82 + clamp(planet.temp, -60, 60) * 0.001, 0.98, latitude + fine * 0.035);
      const rocky = planet.kind === "rocky" && !planet.habitable && planet.water < 0.08;
      let red: number, green: number, blue: number;
      if (planet.kind === "gas") {
        const band = Math.sin(y * 49 + fbm(x * 12, y * 9, z * 12, seed + 61, 3) * 7) * 0.5 + 0.5;
        const filament = noise(x * 56, y * 85, z * 56, seed + 31) * 0.14 + 0.87;
        red = mix(base[0] * 0.63, 219, band) * filament; green = mix(base[1] * 0.57, 201, band) * filament; blue = mix(base[2] * 0.52, 173, band) * filament;
      } else if (planet.kind === "desert" || rocky) {
        const detail = 0.51 + elevation * 0.74 + fine * 0.11;
        red = base[0] * detail; green = base[1] * detail; blue = base[2] * detail;
        const polar = planet.kind === "desert" ? ice * 0.6 : 0;
        red = mix(red, 190, polar); green = mix(green, 184, polar); blue = mix(blue, 170, polar);
      } else if (planet.kind === "ice") {
        const fissure = smooth(0.35, 0.72, Math.abs(Math.sin(elevation * 52 + fine * 0.5)));
        const detail = (0.55 + elevation * 0.45) * (0.72 + fissure * 0.28);
        red = mix(base[0], 205, 0.6) * detail; green = mix(base[1], 221, 0.6) * detail; blue = mix(base[2], 225, 0.6) * detail;
      } else {
        const terrainR = mix(58, 144, arid * 0.65) + mountain * 50;
        const terrainG = mix(88, 128, arid * 0.65) + mountain * 28;
        const terrainB = mix(58, 79, arid * 0.65) + mountain * 30;
        const detail = 0.76 + fine * 0.38;
        red = mix(11 + shore * 14, terrainR * detail, land);
        green = mix(34 + shore * 28, terrainG * detail, land);
        blue = mix(51 + shore * 27, terrainB * detail, land);
        red = mix(red, 204, ice); green = mix(green, 216, ice); blue = mix(blue, 219, ice);
      }
      atlas.colors[i * 3] = red; atlas.colors[i * 3 + 1] = green; atlas.colors[i * 3 + 2] = blue;
      atlas.land[i] = land;
      atlas.elevation[i] = elevation;
      atlas.regions[i] = closest;
      atlas.borders[i] = directions.length > 1 ? (1 - smooth(0.001, 0.012, nearest - second)) * land : 0;
      atlas.cityLight[i] = cityLight * (fine > 0.62 ? 1 : 0.06);
      if (planet.habitable || planet.kind === "ocean") {
        const weather = fbm(x * 5.4 + 13, y * 4.0, z * 5.4 - 8, seed + 277, 4);
        const streak = noise(x * 42, y * 17, z * 42, seed + 167);
        atlas.clouds[i] = smooth(0.47, 0.69, weather + streak * 0.13) * 0.78;
      }
    }
  }
  if (atlasCache.size > 5) atlasCache.delete(atlasCache.keys().next().value!);
  atlasCache.set(key, atlas);
  return atlas;
}

function project(v: Vec, yaw: number, pitch: number): Vec {
  const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
  const x = cy * v[0] - sy * v[2], z = sy * v[0] + cy * v[2];
  return [x, cp * v[1] + sp * z, -sp * v[1] + cp * z];
}

export default function SoftwareCosmos(props: CosmosSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const currentRef = useRef(props);
  currentRef.current = props;
  const drawRef = useRef<(() => void) | null>(null);
  const cameraRef = useRef({ yaw: -0.18, pitch: -0.09, zoom: 1 });
  const resetRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const host = hostRef.current, canvas = canvasRef.current;
    if (!host || !canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;
    cameraRef.current = { yaw: -0.18, pitch: -0.09, zoom: 1 };
    let width = 1, height = 1, frame = 0;
    const ratio = Math.min(window.devicePixelRatio || 1, 1.4);
    const sphereCanvas = document.createElement("canvas");
    const sphereCtx = sphereCanvas.getContext("2d");
    const labelLayer = document.createElement("div");
    labelLayer.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;";
    host.appendChild(labelLayer);
    const labels = new Map<string, HTMLButtonElement>();
    const rng = seeded(currentRef.current.world.planets[0]?.seed ?? 1);
    const stars = Array.from({ length: 480 }, () => ({ x: rng(), y: rng(), brightness: 0.12 + rng() ** 3 * 0.55, size: rng() > 0.98 ? 1.3 : 0.65 }));
    let lastAtlasKey = "";
    let atlas: Atlas | null = null;
    let spherePixels: ImageData | null = null;

    const reset = () => { cameraRef.current = { yaw: -0.18, pitch: -0.09, zoom: 1 }; scheduleDraw(); };
    resetRef.current = reset;

    function background() {
      ctx!.fillStyle = "#06090c"; ctx!.fillRect(0, 0, width, height);
      for (const star of stars) {
        ctx!.fillStyle = `rgba(190,209,218,${star.brightness})`;
        ctx!.fillRect(star.x * width, star.y * height, star.size, star.size);
      }
    }

    function drawGlobe(planet: Planet, world: World) {
      if (!sphereCtx) return;
      labelLayer.style.display = "none";
      const societies = world.societies.filter(s => s.planetId === planet.id).slice(0, 12);
      const atlasKey = `${planet.id}:${planet.seed}:${societies.map(s => s.id).join(",")}`;
      if (lastAtlasKey !== atlasKey) { atlas = atlasFor(planet, societies); lastAtlasKey = atlasKey; }
      if (!atlas) return;
      const radius = Math.min(width * 0.39, height * 0.39) * cameraRef.current.zoom;
      const centerX = width * 0.51, centerY = height * 0.53;
      const diameter = Math.round(clamp(radius * 2 * ratio, 240, 520));
      if (sphereCanvas.width !== diameter) { sphereCanvas.width = sphereCanvas.height = diameter; spherePixels = sphereCtx.createImageData(diameter, diameter); }
      if (!spherePixels) spherePixels = sphereCtx.createImageData(diameter, diameter);
      const pixels = spherePixels.data;
      const { yaw, pitch } = cameraRef.current;
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      const regionColors = societies.map(s => rgb(s.color));
      const electric = societies.map(s => clamp((s.tech - 50) / 40, 0, 1) * clamp(Math.log10(Math.max(s.population, 1)) / 8, 0, 1.2));
      const layer = currentRef.current.layer;
      const temp = planet.id === world.homePlanetId ? world.climate.temperature : planet.temp;
      const size = diameter / 2, a = atlas;
      const cloudOffset = (Math.floor(world.year * 0.11) % a.width + a.width) % a.width;
      const useClouds = layer === "natural";
      for (let py = 0; py < diameter; py++) {
        const ny = (size - py - 0.5) / size;
        for (let px = 0; px < diameter; px++) {
          const nx = (px + 0.5 - size) / size;
          const rr = nx * nx + ny * ny, pi = (py * diameter + px) * 4;
          if (rr > 1) { pixels[pi + 3] = 0; continue; }
          const nz = Math.sqrt(1 - rr), q = sp * ny + cp * nz;
          const x = cy * nx + sy * q, y = cp * ny - sp * nz, z = -sy * nx + cy * q;
          const u = clamp(Math.floor((Math.atan2(x, z) / TAU + 0.5) * a.width), 0, a.width - 1);
          const v = clamp(Math.floor((0.5 - Math.asin(clamp(y, -1, 1)) / Math.PI) * (a.height - 1)), 0, a.height - 1);
          const index = v * a.width + u;
          let red = a.colors[index * 3], green = a.colors[index * 3 + 1], blue = a.colors[index * 3 + 2];
          const land = a.land[index];
          if (layer === "political" && regionColors.length) {
            const color = regionColors[a.regions[index]] ?? regionColors[0];
            const amount = land * 0.62;
            red = mix(red, color[0] * 0.72, amount); green = mix(green, color[1] * 0.72, amount); blue = mix(blue, color[2] * 0.72, amount);
            const border = a.borders[index] * 0.65;
            red = mix(red, color[0], border); green = mix(green, color[1], border); blue = mix(blue, color[2], border);
          } else if (layer === "climate") {
            const heat = clamp((temp + 28 - Math.abs(y) * 47 - Math.max(0, a.elevation[index] - 0.55) * 60) / 61, 0, 1);
            const color: Vec = heat < 0.5 ? [mix(39, 130, heat * 2), mix(101, 143, heat * 2), mix(140, 99, heat * 2)] : [mix(130, 195, heat * 2 - 1), mix(143, 89, heat * 2 - 1), mix(99, 58, heat * 2 - 1)];
            red = mix(red, color[0], 0.77); green = mix(green, color[1], 0.77); blue = mix(blue, color[2], 0.77);
          }
          const cloud = useClouds ? a.clouds[v * a.width + ((u + cloudOffset) % a.width)] : 0;
          red = mix(red, 217, cloud); green = mix(green, 227, cloud); blue = mix(blue, 229, cloud);
          // Fixed light in model coordinates; camera rotation reveals the night side.
          const ndl = x * -0.49 + y * 0.36 + z * 0.795;
          const day = smooth(-0.12, 0.15, ndl);
          const luminance = 0.045 + Math.max(0, ndl) * 1.03;
          const limb = (1 - nz) ** 4;
          const atmospheric = planet.habitable || planet.kind === "ocean";
          red = red * luminance + (atmospheric ? 17 * limb * day : 0);
          green = green * luminance + (atmospheric ? 52 * limb * day : 0);
          blue = blue * luminance + (atmospheric ? 85 * limb * day : 0);
          if (layer === "natural") {
            if (atmospheric) {
              const spec = Math.max(0, nx * -0.27 + ny * 0.20 + nz * 0.94) ** 65 * (1 - land) * (1 - cloud) * day;
              red += spec * 54; green += spec * 70; blue += spec * 85;
            }
            // Enclosed colonies also emit light on airless or desert worlds.
            const light = a.cityLight[index] * (electric[a.regions[index]] ?? 0) * (1 - day) * (1 - cloud * 0.8);
            red += light * 240; green += light * 153; blue += light * 68;
          }
          pixels[pi] = red; pixels[pi + 1] = green; pixels[pi + 2] = blue;
          pixels[pi + 3] = clamp((1 - rr) * size * 1.3, 0, 1) * 255;
        }
      }
      sphereCtx.putImageData(spherePixels, 0, 0);
      if (planet.habitable || planet.kind === "ocean" || planet.kind === "gas") {
        const halo = ctx!.createRadialGradient(centerX, centerY, radius * 0.98, centerX, centerY, radius * 1.055);
        halo.addColorStop(0, "rgba(71,124,169,.18)"); halo.addColorStop(0.4, "rgba(52,105,161,.12)"); halo.addColorStop(1, "rgba(38,84,140,0)");
        ctx!.fillStyle = halo; ctx!.beginPath(); ctx!.arc(centerX, centerY, radius * 1.055, 0, TAU); ctx!.fill();
      }
      const rings = planet.kind === "gas" && planet.seed % 3 !== 0;
      const ring = (front: boolean) => {
        ctx!.save(); ctx!.translate(centerX, centerY); ctx!.rotate(-0.35);
        for (let r = 1.3; r <= 1.95; r += 0.012) {
          const opacity = 0.10 + (Math.sin(r * 191) + 1) * 0.07;
          ctx!.strokeStyle = `rgba(192,172,140,${opacity})`; ctx!.lineWidth = 1.4;
          ctx!.beginPath(); ctx!.ellipse(0, 0, radius * r, radius * r * 0.29, 0, front ? 0 : Math.PI, front ? Math.PI : TAU); ctx!.stroke();
        }
        ctx!.restore();
      };
      if (rings) ring(false);
      ctx!.imageSmoothingEnabled = true; ctx!.imageSmoothingQuality = "high";
      ctx!.drawImage(sphereCanvas, centerX - radius, centerY - radius, radius * 2, radius * 2);
      if (rings) ring(true);
      const missions = world.missions.filter(m => m.planetId === planet.id && m.active);
      missions.slice(0, 3).forEach((mission, index) => {
        ctx!.save(); ctx!.translate(centerX, centerY); ctx!.rotate(0.3 + index * 0.7);
        ctx!.strokeStyle = "rgba(143,178,158,.23)"; ctx!.lineWidth = 0.7;
        ctx!.beginPath(); ctx!.ellipse(0, 0, radius * (1.16 + index * 0.08), radius * 0.42, 0, 0, TAU); ctx!.stroke();
        const angle = world.year * 0.31 + index * 2.1;
        const xx = Math.cos(angle) * radius * (1.16 + index * 0.08), yy = Math.sin(angle) * radius * 0.42;
        ctx!.fillStyle = "#a5c0ac"; ctx!.fillRect(xx - 1.5, yy - 1.5, 3, 3);
        ctx!.restore();
      });
      for (const society of societies) {
        const [sx, sy, sz] = project(unit(society.lat, society.lon), yaw, pitch);
        if (sz < 0.2) continue;
        const isSelected = society.id === currentRef.current.selectedSocietyId;
        if (layer !== "political" && !isSelected) continue;
        const x = centerX + sx * radius, y = centerY - sy * radius;
        ctx!.fillStyle = society.color; ctx!.beginPath(); ctx!.arc(x, y, isSelected ? 3 : 2, 0, TAU); ctx!.fill();
        ctx!.strokeStyle = `${society.color}66`; ctx!.lineWidth = 1; ctx!.beginPath(); ctx!.arc(x, y, 6, 0, TAU); ctx!.stroke();
        ctx!.font = "11px ui-monospace,Consolas,monospace";
        const textWidth = ctx!.measureText(society.name).width;
        const tx = clamp(x + 11, 4, width - textWidth - 8), ty = y + 4;
        ctx!.fillStyle = "rgba(6,9,12,.78)"; ctx!.fillRect(tx - 4, ty - 13, textWidth + 8, 19);
        ctx!.fillStyle = society.color; ctx!.fillText(society.name, tx, ty);
      }
    }

    function drawSystem(world: World) {
      labelLayer.style.display = "block";
      const centerX = width * 0.50, centerY = height * 0.52;
      const outer = Math.min(width * 0.41, height * 0.69) * cameraRef.current.zoom;
      const tilt = clamp(0.40 + cameraRef.current.pitch + 0.09, 0.12, 0.90);
      const axis = -0.24 + (cameraRef.current.yaw + 0.18) * 0.6;
      const transform = (x: number, y: number) => [centerX + Math.cos(axis) * x - Math.sin(axis) * y, centerY + Math.sin(axis) * x + Math.cos(axis) * y] as const;
      const points: { planet: Planet; x: number; y: number; radius: number }[] = [];
      ctx!.save(); ctx!.translate(centerX, centerY); ctx!.rotate(axis);
      for (let index = 0; index < world.planets.length; index++) {
        const planet = world.planets[index];
        const r = outer * (0.20 + 0.80 * index / Math.max(1, world.planets.length - 1));
        ctx!.beginPath(); ctx!.ellipse(0, 0, r, r * tilt, 0, 0, TAU);
        ctx!.strokeStyle = planet.id === currentRef.current.selectedPlanetId ? "rgba(136,163,139,.65)" : "rgba(104,126,135,.25)";
        ctx!.lineWidth = planet.id === currentRef.current.selectedPlanetId ? 1 : 0.7; ctx!.stroke();
        const period = Math.sqrt(planet.orbit ** 3 / world.star.mass);
        const angle = planet.seed % 1000 * 0.00628 + world.year / period * TAU;
        const [x, y] = transform(Math.sin(angle) * r, Math.cos(angle) * r * tilt);
        points.push({ planet, x, y, radius: clamp(4 * Math.cbrt(planet.radius), 3.5, 10) });
      }
      ctx!.restore();
      const glow = ctx!.createRadialGradient(centerX, centerY, 0, centerX, centerY, 46);
      glow.addColorStop(0, "rgba(255,228,176,.55)"); glow.addColorStop(0.3, "rgba(232,178,96,.12)"); glow.addColorStop(1, "rgba(232,178,96,0)");
      ctx!.fillStyle = glow; ctx!.fillRect(centerX - 46, centerY - 46, 92, 92);
      const star = ctx!.createRadialGradient(centerX - 2, centerY - 3, 1, centerX, centerY, 10);
      star.addColorStop(0, "#fff4d8"); star.addColorStop(0.5, world.star.color); star.addColorStop(1, "#ba7942");
      ctx!.fillStyle = star; ctx!.beginPath(); ctx!.arc(centerX, centerY, 10, 0, TAU); ctx!.fill();
      ctx!.font = "10px ui-monospace,Consolas,monospace"; ctx!.fillStyle = "#b79f78"; ctx!.textAlign = "center"; ctx!.fillText(world.star.name, centerX, centerY + 29); ctx!.textAlign = "left";
      points.sort((a, b) => a.y - b.y).forEach(({ planet, x, y, radius }) => {
        const lightX = (centerX - x) / Math.max(1, Math.hypot(centerX - x, centerY - y)), lightY = (centerY - y) / Math.max(1, Math.hypot(centerX - x, centerY - y));
        if (planet.kind === "gas" && planet.seed % 3 !== 0) { ctx!.strokeStyle = `${planet.color}66`; ctx!.lineWidth = 2.2; ctx!.beginPath(); ctx!.ellipse(x, y, radius * 1.9, radius * 0.55, -0.35, 0, TAU); ctx!.stroke(); }
        const fill = ctx!.createRadialGradient(x + lightX * radius * 0.4, y + lightY * radius * 0.4, 0, x, y, radius);
        fill.addColorStop(0, planet.color); fill.addColorStop(0.55, planet.color); fill.addColorStop(1, "#0d151a");
        ctx!.fillStyle = fill; ctx!.beginPath(); ctx!.arc(x, y, radius, 0, TAU); ctx!.fill();
        if (planet.habitable) { ctx!.strokeStyle = "rgba(92,159,178,.45)"; ctx!.lineWidth = 1; ctx!.stroke(); }
        let label = labels.get(planet.id);
        if (!label) {
          label = document.createElement("button"); label.type = "button";
          label.style.cssText = "position:absolute;pointer-events:auto;transform:translate(-50%,0);white-space:nowrap;padding:5px 7px;border:1px solid rgba(118,139,143,.16);border-radius:3px;background:rgba(6,9,12,.82);color:#b7c5c6;font:10px/1.3 ui-monospace,Consolas,monospace;cursor:pointer;";
          const planetId = planet.id; label.addEventListener("click", () => currentRef.current.onSelectPlanet(planetId));
          labelLayer.appendChild(label); labels.set(planet.id, label);
        }
        label.textContent = planet.name; label.setAttribute("aria-label", `Открыть планету ${planet.name}`);
        label.style.left = `${clamp(x, 45, width - 45)}px`; label.style.top = `${y + radius + 8}px`;
        label.style.borderColor = planet.id === currentRef.current.selectedPlanetId ? "#72866d" : "rgba(118,139,143,.16)";
      });
      for (const [id, label] of labels) if (!world.planets.some(planet => planet.id === id)) { label.remove(); labels.delete(id); }
    }

    function draw() {
      frame = 0;
      const { world, mode, selectedPlanetId } = currentRef.current;
      const planet = world.planets.find(p => p.id === selectedPlanetId) ?? world.planets[0];
      ctx!.setTransform(ratio, 0, 0, ratio, 0, 0);
      background();
      if (mode === "system") drawSystem(world); else if (planet) drawGlobe(planet, world);
    }
    function scheduleDraw() { if (!frame) frame = requestAnimationFrame(draw); }
    drawRef.current = scheduleDraw;
    const resize = () => {
      width = Math.max(1, host.clientWidth); height = Math.max(1, host.clientHeight);
      canvas.width = Math.ceil(width * ratio); canvas.height = Math.ceil(height * ratio); scheduleDraw();
    };
    const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(host); resize();
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchDistance = 0;
    const distanceBetweenPointers = () => {
      const [a, b] = [...pointers.values()];
      return a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      pinchDistance = distanceBetweenPointers();
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = "grabbing";
    };
    const move = (e: PointerEvent) => {
      const previous = pointers.get(e.pointerId);
      if (!previous) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size > 1) {
        const distance = distanceBetweenPointers();
        if (pinchDistance > 2 && distance > 2) cameraRef.current.zoom = clamp(cameraRef.current.zoom * distance / pinchDistance, 0.65, 1.75);
        pinchDistance = distance;
      } else {
        cameraRef.current.yaw -= (e.clientX - previous.x) * 0.008;
        cameraRef.current.pitch = clamp(cameraRef.current.pitch + (e.clientY - previous.y) * 0.008, -1.3, 1.3);
      }
      scheduleDraw();
    };
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      pinchDistance = distanceBetweenPointers();
      canvas.style.cursor = pointers.size ? "grabbing" : "grab";
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };
    const wheel = (e: WheelEvent) => { e.preventDefault(); cameraRef.current.zoom = clamp(cameraRef.current.zoom * Math.exp(-e.deltaY * 0.001), 0.65, 1.75); scheduleDraw(); };
    canvas.addEventListener("pointerdown", down); canvas.addEventListener("pointermove", move); canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up); canvas.addEventListener("lostpointercapture", up); canvas.addEventListener("wheel", wheel, { passive: false });
    return () => {
      cancelAnimationFrame(frame); resizeObserver.disconnect(); labelLayer.remove(); drawRef.current = null; resetRef.current = null;
      canvas.removeEventListener("pointerdown", down); canvas.removeEventListener("pointermove", move); canvas.removeEventListener("pointerup", up); canvas.removeEventListener("pointercancel", up); canvas.removeEventListener("lostpointercapture", up); canvas.removeEventListener("wheel", wheel);
    };
  }, [props.world.id]);

  useEffect(() => { drawRef.current?.(); }, [props.world, props.mode, props.selectedPlanetId, props.layer]);
  useEffect(() => { resetRef.current?.(); }, [props.focus, props.selectedPlanetId]);
  useEffect(() => {
    const society = props.world.societies.find(s => s.id === props.selectedSocietyId && s.planetId === props.selectedPlanetId);
    if (society) { cameraRef.current.yaw = society.lon * Math.PI / 180; cameraRef.current.pitch = -society.lat * Math.PI / 180; drawRef.current?.(); }
  }, [props.selectedSocietyId, props.selectedPlanetId]);

  return <div ref={hostRef} style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#06090c" }}>
    <canvas ref={canvasRef} aria-label={props.mode === "planet" ? "Глобус. Перетаскивайте для поворота, прокручивайте для приближения" : "Обзор звёздной системы"} role="img" style={{ display: "block", width: "100%", height: "100%", touchAction: "none", cursor: "grab" }} />
    <span style={{ position: "absolute", left: 20, bottom: 65, font: "9px ui-monospace,Consolas,monospace", color: "#667579", pointerEvents: "none" }}>Обзорная визуализация</span>
  </div>;
}
