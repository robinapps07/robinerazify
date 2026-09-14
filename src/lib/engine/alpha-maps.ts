import { MAP_PACK, type MapPack } from "./maps-data";
import type { MapKind } from "./types";

type Decoded = { id: string; kind: string; w: number; h: number; map: Float32Array };

const decoded = new Map<string, Decoded>();
const cache = new Map<string, Float32Array>();

function decodeB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodePack(entry: MapPack): Decoded {
  let d = decoded.get(entry.id);
  if (d) return d;
  const raw = decodeB64(entry.b64);
  const map = new Float32Array(entry.w * entry.h);
  for (let i = 0; i < map.length; i++) map[i] = (raw[i] ?? 0) / 255;
  d = { id: entry.id, kind: entry.kind, w: entry.w, h: entry.h, map };
  decoded.set(entry.id, d);
  return d;
}

export function packedMaps(kind?: MapKind): Decoded[] {
  return MAP_PACK.filter((m) => !kind || m.kind === kind).map(decodePack);
}

export function getPackedById(id: string): Decoded | null {
  const entry = MAP_PACK.find((m) => m.id === id);
  return entry ? decodePack(entry) : null;
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const abx = bx - ax;
  const aby = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby || 1)));
  const dx = px - (ax + t * abx);
  const dy = py - (ay + t * aby);
  return Math.hypot(dx, dy);
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0 || 1)));
  return t * t * (3 - 2 * t);
}

function generateDolaWordmark(width: number, height: number): Float32Array {
  const w = Math.max(8, Math.round(width));
  const h = Math.max(8, Math.round(height));
  const map = new Float32Array(w * h);
  if (typeof document === "undefined") {
    const barH = Math.max(3, Math.round(h * 0.5));
    const y0 = Math.round((h - barH) / 2);
    for (let y = 0; y < h; y++) {
      const py = y - y0;
      if (py < 0 || py >= barH) continue;
      for (let x = 0; x < w; x++) {
        const nx = x / w;
        const inBar =
          (nx > 0.02 && nx < 0.16) ||
          (nx > 0.2 && nx < 0.34) ||
          (nx > 0.38 && nx < 0.5) ||
          (nx > 0.54 && nx < 0.66) ||
          (nx > 0.74 && nx < 0.84) ||
          (nx > 0.88 && nx < 0.98);
        if (!inBar) continue;
        map[y * w + x] = 0.82 * smoothstep(0, 1.4, Math.min(py, barH - 1 - py));
      }
    }
    return map;
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return map;
  ctx.clearRect(0, 0, w, h);
  ctx.font = `500 ${Math.round(h * 0.78)}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.fillText("Dola AI", Math.max(1, Math.round(w * 0.02)), h / 2 + 0.4);
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < map.length; i++) {
    const a = (img.data[i * 4] ?? 0) / 255;
    map[i] = a > 0.04 ? a : 0;
  }
  return map;
}

function generateChatgpt(size: number): Float32Array {
  const map = new Float32Array(size * size);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const s = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - cx) / s;
      const dy = (y - cy) / s;
      const r = Math.hypot(dx, dy);
      let a = 0;
      for (let i = 0; i < 6; i++) {
        const ang = (i * Math.PI) / 3 + Math.PI / 6;
        const px = Math.cos(ang);
        const py = Math.sin(ang);
        const along = dx * px + dy * py;
        const across = -dx * py + dy * px;
        if (along > 0) a = Math.max(a, Math.exp(-((across / 0.13) ** 2) - ((along - 0.28) / 0.28) ** 2));
      }
      a = Math.max(a, Math.exp(-r * r * 18) * 0.7) * smoothstep(0.95, 0.55, r);
      map[y * size + x] = a * 0.7;
    }
  }
  return map;
}

function generateFlux(size: number): Float32Array {
  const map = new Float32Array(size * size);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const s = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - cx) / s;
      const dy = (y - cy) / s;
      const r = Math.hypot(dx, dy);
      const ring = smoothstep(0.12, 0.05, Math.abs(r - 0.34));
      const bar = smoothstep(0.1, 0.035, Math.abs(dx)) * smoothstep(0.42, 0.22, Math.abs(dy));
      map[y * size + x] = Math.min(1, Math.max(ring, bar)) * 0.7 * smoothstep(0.85, 0.5, r);
    }
  }
  return map;
}

function generateIdeogram(size: number): Float32Array {
  const map = new Float32Array(size * size);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const s = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - cx) / s;
      const dy = (y - cy) / s;
      const stem = smoothstep(0.09, 0.03, Math.abs(dx)) * smoothstep(0.42, 0.18, Math.abs(dy - 0.06));
      const dot = Math.exp(-(dx * dx + (dy + 0.38) ** 2) / 0.012);
      map[y * size + x] = Math.min(1, stem + dot) * 0.72;
    }
  }
  return map;
}

function generateMidjourney(size: number): Float32Array {
  const map = new Float32Array(size * size);
  const w = size;
  const h = Math.max(12, Math.round(size * 0.38));
  const y0 = Math.round((size - h) / 2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const py = y - y0;
      if (py < 0 || py >= h) continue;
      const nx = x / w;
      const inBar = (nx > 0.08 && nx < 0.28) || (nx > 0.38 && nx < 0.58) || (nx > 0.68 && nx < 0.9);
      if (!inBar) continue;
      const v = py > h * 0.18 && py < h * 0.82 ? 0.7 : 0;
      map[y * size + x] = v * smoothstep(0, 2, Math.min(py, h - 1 - py));
    }
  }
  return map;
}

function generateSora(size: number): Float32Array {
  const map = new Float32Array(size * size);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const s = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - cx) / s;
      const dy = (y - cy) / s;
      const r = Math.hypot(dx, dy);
      const petal = Math.exp(-(((r - 0.22) / 0.22) ** 2)) * Math.pow(Math.abs(Math.cos(3 * Math.atan2(dy, dx))), 0.7);
      const core = Math.exp(-r * r * 14);
      map[y * size + x] = Math.min(1, petal * 0.85 + core * 0.4) * 0.68 * smoothstep(0.9, 0.5, r);
    }
  }
  return map;
}

function generateGeneric(size: number): Float32Array {
  const map = new Float32Array(size * size);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const s = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - cx) / s;
      const dy = (y - cy) / s;
      const r = Math.max(Math.abs(dx), Math.abs(dy));
      map[y * size + x] = Math.min(1, smoothstep(0.78, 0.55, r) * 0.35 + Math.exp(-(dx * dx + dy * dy) * 2.2) * 0.4);
    }
  }
  return map;
}

function generateGrokWordmark(width: number, height: number): Float32Array {
  const w = Math.max(8, Math.round(width));
  const h = Math.max(8, Math.round(height));
  const map = new Float32Array(w * h);
  if (typeof document === "undefined") {
    const barH = Math.max(3, Math.round(h * 0.42));
    const y0 = Math.round((h - barH) / 2);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const py = y - y0;
        if (py < 0 || py >= barH) continue;
        const nx = x / w;
        const inBar =
          (nx > 0.04 && nx < 0.22) ||
          (nx > 0.28 && nx < 0.46) ||
          (nx > 0.52 && nx < 0.7) ||
          (nx > 0.76 && nx < 0.96);
        if (!inBar) continue;
        const edge = Math.min(py, barH - 1 - py);
        map[y * w + x] = 0.78 * smoothstep(0, 1.6, edge);
      }
    }
    return map;
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return map;
  ctx.clearRect(0, 0, w, h);
  const fontSize = Math.round(h * 0.82);
  ctx.font = `600 ${fontSize}px "Plus Jakarta Sans", "Segoe UI", Arial, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.fillText("Grok", Math.max(1, Math.round(w * 0.02)), h / 2 + 0.5);
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < map.length; i++) {
    const a = (img.data[i * 4] ?? 0) / 255;
    map[i] = a > 0.04 ? a : 0;
  }
  return map;
}

export function generateGrokLockup(width: number, height: number): Float32Array {
  const w = Math.max(8, Math.round(width));
  const h = Math.max(8, Math.round(height));
  const map = new Float32Array(w * h);
  const iconSize = Math.min(w, h);
  const packed = getPackedById("grok48") ?? getPackedById("grok64") ?? getPackedById("grok96");
  const icon = packed
    ? packed.w === iconSize && packed.h === iconSize
      ? packed.map
      : scaleAlphaMap(packed.map, packed.w, packed.h, iconSize, iconSize)
    : generateGrokFallback(iconSize);

  const iconX = 0;
  const iconY = Math.max(0, Math.round((h - iconSize) / 2));
  for (let y = 0; y < iconSize; y++) {
    for (let x = 0; x < iconSize; x++) {
      const dx = iconX + x;
      const dy = iconY + y;
      if (dx < 0 || dy < 0 || dx >= w || dy >= h) continue;
      map[dy * w + dx] = icon[y * iconSize + x] ?? 0;
    }
  }

  const textX = Math.round(iconSize * 0.9);
  const textW = Math.max(4, w - textX);
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = textW;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, textW, h);
      ctx.font = `600 ${Math.round(h * 0.72)}px "Plus Jakarta Sans", "Segoe UI", Arial, sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#ffffff";
      ctx.fillText("Grok", 1, h / 2 + 0.5);
      const img = ctx.getImageData(0, 0, textW, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < textW; x++) {
          const a = ((img.data[(y * textW + x) * 4] ?? 0) / 255) * 0.74;
          if (a < 0.04) continue;
          const di = y * w + textX + x;
          if (a > (map[di] ?? 0)) map[di] = a;
        }
      }
    }
  } else {
    const barH = Math.max(3, Math.round(h * 0.42));
    const y0 = Math.round((h - barH) / 2);
    for (let y = 0; y < h; y++) {
      const py = y - y0;
      if (py < 0 || py >= barH) continue;
      for (let x = textX; x < w; x++) {
        const nx = (x - textX) / Math.max(1, textW);
        const inBar =
          (nx > 0.02 && nx < 0.2) ||
          (nx > 0.26 && nx < 0.44) ||
          (nx > 0.5 && nx < 0.68) ||
          (nx > 0.74 && nx < 0.96);
        if (!inBar) continue;
        map[y * w + x] = Math.max(map[y * w + x] ?? 0, 0.7 * smoothstep(0, 1.4, Math.min(py, barH - 1 - py)));
      }
    }
  }
  return map;
}

export function getGrokLockup(width: number, height: number): Float32Array {
  const w = Math.max(8, Math.round(width));
  const h = Math.max(8, Math.round(height));
  const key = `grokLockup:${w}x${h}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const map = generateGrokLockup(w, h);
  cache.set(key, map);
  return map;
}

export const GROK_LOCKUP_RATIO = 3.9;

export function grokLockupSize(height: number) {
  const h = Math.max(18, Math.round(height));
  return { width: Math.max(h + 8, Math.round(h * GROK_LOCKUP_RATIO)), height: h };
}

export function getGrokWordmark(width: number, height: number): Float32Array {
  const w = Math.max(8, Math.round(width));
  const h = Math.max(8, Math.round(height));
  const key = `grokWord:${w}x${h}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const map = generateGrokWordmark(w, h);
  cache.set(key, map);
  return map;
}

export const DOLA_WORD_RATIO = 4.8;

export function getDolaWordmark(width: number, height: number): Float32Array {
  const w = Math.max(8, Math.round(width));
  const h = Math.max(8, Math.round(height));
  const key = `dolaWord:${w}x${h}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const map = generateDolaWordmark(w, h);
  cache.set(key, map);
  return map;
}

function generateGrokFallback(size: number): Float32Array {
  const map = new Float32Array(size * size);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const s = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - cx) / s;
      const dy = (y - cy) / s;
      const r = Math.hypot(dx, dy);
      const ring = smoothstep(0.1, 0.045, Math.abs(r - 0.38));
      const slash = smoothstep(0.085, 0.03, distToSegment(dx, dy, -0.42, 0.42, 0.42, -0.42));
      const cap = r < 0.62 ? 1 : smoothstep(0.78, 0.62, r);
      map[y * size + x] = Math.min(1, Math.max(ring, slash) * cap) * 0.78;
    }
  }
  return map;
}

const GENERATORS: Partial<Record<MapKind, (size: number) => Float32Array>> = {
  chatgpt: generateChatgpt,
  flux: generateFlux,
  ideogram: generateIdeogram,
  midjourney: generateMidjourney,
  sora: generateSora,
  generic: generateGeneric,
  grok: generateGrokFallback,
};

function pickPacked(kind: MapKind, width: number, height: number): Decoded | null {
  const list = packedMaps(kind);
  if (!list.length) return null;
  let best = list[0]!;
  let bestD = Infinity;
  for (const m of list) {
    const d = Math.abs(m.w - width) + Math.abs(m.h - height);
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  }
  return best;
}

export function scaleAlphaMap(src: Float32Array, srcW: number, srcH: number, dstW: number, dstH: number): Float32Array {
  const out = new Float32Array(dstW * dstH);
  if (dstW === srcW && dstH === srcH) {
    out.set(src);
    return out;
  }
  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const sx = ((x + 0.5) * srcW) / dstW - 0.5;
      const sy = ((y + 0.5) * srcH) / dstH - 0.5;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const tx = sx - x0;
      const ty = sy - y0;
      const s00 = sample(src, srcW, srcH, x0, y0);
      const s10 = sample(src, srcW, srcH, x0 + 1, y0);
      const s01 = sample(src, srcW, srcH, x0, y0 + 1);
      const s11 = sample(src, srcW, srcH, x0 + 1, y0 + 1);
      out[y * dstW + x] = s00 * (1 - tx) * (1 - ty) + s10 * tx * (1 - ty) + s01 * (1 - tx) * ty + s11 * tx * ty;
    }
  }
  return out;
}

function sample(src: Float32Array, w: number, h: number, x: number, y: number) {
  if (x < 0 || y < 0 || x >= w || y >= h) return 0;
  return src[y * w + x] ?? 0;
}

export function getAlphaMap(kind: MapKind, width: number, height = width): Float32Array {
  const w = Math.max(4, Math.round(width));
  const h = Math.max(4, Math.round(height));
  const key = `${kind}:${w}x${h}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const packed = pickPacked(kind, w, h);
  let map: Float32Array;
  if (kind === "grok" && Math.abs(w - h) > 6) {
    map = getGrokLockup(w, h);
  } else if (kind === "dola") {
    map = getDolaWordmark(w, h);
  } else if (packed) {
    map = packed.w === w && packed.h === h ? packed.map : scaleAlphaMap(packed.map, packed.w, packed.h, w, h);
  } else {
    const gen = GENERATORS[kind];
    const square = gen ? gen(Math.max(w, h)) : new Float32Array(w * h);
    map = w === h && square.length === w * h ? square : scaleAlphaMap(square, Math.max(w, h), Math.max(w, h), w, h);
  }
  cache.set(key, map);
  return map;
}

export function getAlphaMapById(id: string, width?: number, height?: number): Float32Array | null {
  if (id === "grokLockup" || id.startsWith("grokLock")) {
    const w = width ?? 128;
    const h = height ?? Math.max(18, Math.round(w / GROK_LOCKUP_RATIO));
    return getGrokLockup(w, h);
  }
  if (id === "dolaWordmark" || id.startsWith("dolaWord")) {
    const w = width ?? 96;
    const h = height ?? Math.max(14, Math.round(w / DOLA_WORD_RATIO));
    return getDolaWordmark(w, h);
  }
  const packed = getPackedById(id);
  if (!packed) return null;
  const w = width ?? packed.w;
  const h = height ?? packed.h;
  const key = `id:${id}:${w}x${h}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const map = packed.w === w && packed.h === h ? packed.map : scaleAlphaMap(packed.map, packed.w, packed.h, w, h);
  cache.set(key, map);
  return map;
}

export function peakAbs(map: Float32Array) {
  let m = 0;
  for (let i = 0; i < map.length; i++) m = Math.max(m, Math.abs(map[i] ?? 0));
  return m || 1;
}
