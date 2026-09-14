import { getAlphaMap, getDolaWordmark, getGrokLockup, getGrokWordmark, getPackedById, packedMaps, scaleAlphaMap } from "./alpha-maps";
import { catalogHints, defaultHint, geminiPredictedSizes, geminiRatioSeeds, isGemini2kStill, isGemini43_2k, placementFromHint } from "./catalog";
import { boxesOverlap, boxHasGlyph, findDolaCornerMark, findGrokCornerMark, findOverlayBoxes, type OverlayBox } from "./inpaint";
import type { DetectionHit, EngineId, ExtraBox, MapKind } from "./types";
import { mapKindForEngine } from "./types";

function lumaAt(data: Uint8ClampedArray, w: number, x: number, y: number) {
  const i = (y * w + x) * 4;
  return ((data[i] ?? 0) * 2 + (data[i + 1] ?? 0) * 3 + (data[i + 2] ?? 0)) / 6;
}

function nccAt(
  data: Uint8ClampedArray,
  imgW: number,
  imgH: number,
  ox: number,
  oy: number,
  template: Float32Array,
  tw: number,
  th: number,
  invert: boolean,
): number {
  if (ox < 0 || oy < 0 || ox + tw > imgW || oy + th > imgH) return -1;
  const n = tw * th;
  let tMean = 0;
  let pMean = 0;
  let used = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(template[i] ?? 0);
    if (a < 0.02) continue;
    tMean += a;
    const x = ox + (i % tw);
    const y = oy + ((i / tw) | 0);
    pMean += lumaAt(data, imgW, x, y);
    used++;
  }
  if (used < 12) return -1;
  tMean /= used;
  pMean /= used;

  let num = 0;
  let denT = 0;
  let denP = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(template[i] ?? 0);
    if (a < 0.02) continue;
    const t = (invert ? -1 : 1) * a - (invert ? -tMean : tMean);
    const x = ox + (i % tw);
    const y = oy + ((i / tw) | 0);
    const p = lumaAt(data, imgW, x, y) - pMean;
    num += t * p;
    denT += t * t;
    denP += p * p;
  }
  const den = Math.sqrt(denT * denP);
  if (den < 1e-6) return -1;
  return num / den;
}

function estimateGain(
  data: Uint8ClampedArray,
  imgW: number,
  ox: number,
  oy: number,
  template: Float32Array,
  tw: number,
  th: number,
  dark: boolean,
): number {
  const bg: number[] = [];
  const samples: number[] = [];
  const n = tw * th;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(template[i] ?? 0);
    const x = ox + (i % tw);
    const y = oy + ((i / tw) | 0);
    const lum = lumaAt(data, imgW, x, y);
    if (a < 0.04) bg.push(lum);
    else if (a > 0.12) samples.push(i);
  }
  bg.sort((a, b) => a - b);
  const bgLum = bg.length ? (bg[(bg.length / 2) | 0] ?? 128) : 128;
  const logo = dark ? 0 : 255;
  let num = 0;
  let den = 0;
  for (const i of samples) {
    const a = Math.abs(template[i] ?? 0);
    const x = ox + (i % tw);
    const y = oy + ((i / tw) | 0);
    const lum = lumaAt(data, imgW, x, y);
    const expected = a * (logo - bgLum);
    const observed = lum - bgLum;
    if (Math.abs(expected) > 2) {
      num += observed * expected;
      den += expected * expected;
    }
  }
  if (den < 1) return 1;
  return Math.max(0.35, Math.min(1.7, num / den));
}

function toLuma(imageData: ImageData): Float32Array {
  const { data, width, height } = imageData;
  const luma = new Float32Array(width * height);
  for (let p = 0, i = 0; p < luma.length; p++, i += 4) {
    luma[p] = ((data[i] ?? 0) * 2 + (data[i + 1] ?? 0) * 3 + (data[i + 2] ?? 0)) / 6;
  }
  return luma;
}

type PrepTmpl = {
  tw: number;
  th: number;
  idx: Int32Array;
  t: Float32Array;
  tMean: number;
  denT: number;
};

function prepTemplate(map: Float32Array, tw: number, th: number, invert: boolean): PrepTmpl | null {
  const n = tw * th;
  const idx: number[] = [];
  const t: number[] = [];
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(map[i] ?? 0);
    if (a < 0.02) continue;
    const v = invert ? -a : a;
    idx.push(i);
    t.push(v);
    sum += v;
  }
  if (idx.length < 12) return null;
  const tMean = sum / idx.length;
  let denT = 0;
  for (let k = 0; k < t.length; k++) {
    const d = (t[k] ?? 0) - tMean;
    t[k] = d;
    denT += d * d;
  }
  if (denT < 1e-6) return null;
  return { tw, th, idx: Int32Array.from(idx), t: Float32Array.from(t), tMean, denT };
}

function nccPrep(
  luma: Float32Array,
  imgW: number,
  imgH: number,
  ox: number,
  oy: number,
  prep: PrepTmpl,
): number {
  const { tw, th, idx, t, denT } = prep;
  if (ox < 0 || oy < 0 || ox + tw > imgW || oy + th > imgH) return -1;
  const used = idx.length;
  let pMean = 0;
  const p = new Float32Array(used);
  for (let k = 0; k < used; k++) {
    const i = idx[k] ?? 0;
    const x = ox + (i % tw);
    const y = oy + ((i / tw) | 0);
    const v = luma[y * imgW + x] ?? 0;
    p[k] = v;
    pMean += v;
  }
  pMean /= used;
  let num = 0;
  let denP = 0;
  for (let k = 0; k < used; k++) {
    const pv = (p[k] ?? 0) - pMean;
    num += (t[k] ?? 0) * pv;
    denP += pv * pv;
  }
  const den = Math.sqrt(denT * denP);
  if (den < 1e-6) return -1;
  return num / den;
}

function cornerPrior(x: number, y: number, tw: number, th: number, w: number, h: number): number {
  const right = w - (x + tw);
  const bot = h - (y + th);
  if (right < 4 || bot < 4) return 0.72;
  if (right > w * 0.42 || bot > h * 0.28) return 0.55;
  const typical = Math.min(96, Math.max(24, Math.round(Math.min(w, h) * 0.06)));
  const dist = Math.hypot(right - typical, bot - typical) / Math.max(80, Math.min(w, h) * 0.12);
  return 1.18 - Math.min(0.4, dist * 0.35);
}

function brRegion(w: number, h: number, tw: number, th: number) {
  const short = Math.min(w, h);
  const pad = Math.min(Math.max(Math.round(short * 0.3), tw + 48), tw + 280);
  return {
    x0: Math.max(0, w - pad),
    y0: Math.max(0, h - pad),
    x1: w,
    y1: h,
  };
}

function scanTemplate(
  luma: Float32Array,
  imgW: number,
  imgH: number,
  prep: PrepTmpl,
  region: { x0: number; y0: number; x1: number; y1: number },
  step: number,
): { x: number; y: number; score: number } | null {
  const { tw, th } = prep;
  const x0 = region.x0;
  const y0 = region.y0;
  const x1 = Math.max(x0, region.x1 - tw);
  const y1 = Math.max(y0, region.y1 - th);
  if (x1 < x0 || y1 < y0) return null;
  let bestX = x0;
  let bestY = y0;
  let best = -1;
  const st = Math.max(1, step);
  for (let y = y0; y <= y1; y += st) {
    for (let x = x0; x <= x1; x += st) {
      const s = nccPrep(luma, imgW, imgH, x, y, prep);
      if (s > best) {
        best = s;
        bestX = x;
        bestY = y;
      }
    }
  }
  if (best < 0.08) return null;
  const reach = Math.max(st, 8);
  for (let dy = -reach; dy <= reach; dy += 2) {
    for (let dx = -reach; dx <= reach; dx += 2) {
      const x = bestX + dx;
      const y = bestY + dy;
      if (x < 0 || y < 0 || x + tw > imgW || y + th > imgH) continue;
      const s = nccPrep(luma, imgW, imgH, x, y, prep);
      if (s > best) {
        best = s;
        bestX = x;
        bestY = y;
      }
    }
  }
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const x = bestX + dx;
      const y = bestY + dy;
      if (x < 0 || y < 0 || x + tw > imgW || y + th > imgH) continue;
      const s = nccPrep(luma, imgW, imgH, x, y, prep);
      if (s > best) {
        best = s;
        bestX = x;
        bestY = y;
      }
    }
  }
  return { x: bestX, y: bestY, score: best };
}

function templateForSize(id: string, tw: number, th: number): Float32Array | null {
  const packed = getPackedById(id);
  if (!packed) return null;
  if (packed.w === tw && packed.h === th) return packed.map;
  return scaleAlphaMap(packed.map, packed.w, packed.h, tw, th);
}

const GEMINI_MAP_IDS = [
  "diamond48",
  "diamond96",
  "diamond36",
  "sparkle48",
  "sparkle48soft",
  "sparkle36v2",
  "sparkle96",
  "sparkle96soft",
  "sparkle96new",
  "sparkle36",
];
const VEO_MAP_IDS = ["veo68", "veo99"];

function sizePrior(tw: number, th: number, w: number, h: number): number {
  const mark = Math.max(tw, th);
  if (isGemini2kStill(w, h) || isGemini43_2k(w, h)) {
    if (mark >= 36 && mark <= 52) return 1.28;
    if (mark >= 80) return 0.62;
  }
  return 1;
}

function considerScored(
  state: { best: Cand | null },
  imageData: ImageData,
  x: number,
  y: number,
  map: Float32Array,
  tw: number,
  th: number,
  engine: Exclude<EngineId, "auto">,
  mapKind: MapKind,
  mapId: string,
  method: "unblend" | "fill",
  score: number,
  invert: boolean,
): void {
  const w = imageData.width;
  const h = imageData.height;
  const ranked = score * cornerPrior(x, y, tw, th, w, h) * sizePrior(tw, th, w, h);
  const current = state.best;
  const currentRank = current
    ? current.confidence * cornerPrior(current.x, current.y, current.mapW, current.mapH, w, h) * sizePrior(current.mapW, current.mapH, w, h)
    : -1;
  if (!current || ranked > currentRank) {
    const gain = estimateGain(imageData.data, imageData.width, x, y, map, tw, th, invert);
    state.best = {
      engine,
      confidence: Math.max(0, Math.min(0.99, score)),
      size: Math.max(tw, th),
      x,
      y,
      gain,
      polarity: invert ? "dark" : "light",
      mapKind,
      mapId,
      mapW: tw,
      mapH: th,
      method,
      map,
    };
  }
}

function searchGeminiCorner(imageData: ImageData): Cand | null {
  const { width, height } = imageData;
  if (width < 48 || height < 48) return null;
  const luma = toLuma(imageData);
  const state: { best: Cand | null } = { best: null };
  const hints = [...geminiRatioSeeds(width, height), ...catalogHints(width, height, "gemini")];
  const sizes = geminiPredictedSizes(width, height);

  const tryAt = (id: string, tw: number, th: number, kind: MapKind, x: number, y: number) => {
    const map = templateForSize(id, tw, th);
    if (!map) return;
    const prep = prepTemplate(map, tw, th, false);
    if (!prep) return;
    const raw = nccPrep(luma, width, height, x, y, prep);
    if (raw > 0.08) considerScored(state, imageData, x, y, map, tw, th, "gemini", kind, id, "unblend", raw, false);
  };

  const tryMapHints = (id: string, tw: number, th: number, kind: MapKind) => {
    for (const hint of hints) {
      if (Math.abs(hint.size - tw) > 10 && Math.abs((hint.width ?? hint.size) - tw) > 10) continue;
      const p = placementFromHint(width, height, { ...hint, size: tw, width: tw, height: th });
      tryAt(id, tw, th, kind, p.x, p.y);
    }
  };

  for (const id of GEMINI_MAP_IDS) {
    const packed = getPackedById(id);
    if (!packed) continue;
    tryMapHints(id, packed.w, packed.h, "sparkle");
    for (const s of sizes) {
      if (s === packed.w) continue;
      tryMapHints(id, s, s, "sparkle");
    }
  }
  for (const id of VEO_MAP_IDS) {
    const packed = getPackedById(id);
    if (!packed) continue;
    tryMapHints(id, packed.w, packed.h, "veo");
  }

  const preferSmall = isGemini2kStill(width, height) || isGemini43_2k(width, height);
  const denseIds = preferSmall
    ? ["diamond48", "diamond36", "sparkle48"]
    : sizes.some((s) => s >= 72)
      ? ["diamond96", "diamond48"]
      : ["diamond48", "diamond36", "sparkle48"];
  const runDense = (step: number, extraSizes: number[], ids: string[]) => {
    for (const id of ids) {
      const packed = getPackedById(id);
      if (!packed) continue;
      const want = extraSizes.length ? extraSizes : [packed.w];
      for (const s of want) {
        const map = templateForSize(id, s, s);
        if (!map) continue;
        const prep = prepTemplate(map, s, s, false);
        if (!prep) continue;
        const region = brRegion(width, height, s, s);
        const hit = scanTemplate(luma, width, height, prep, region, step);
        if (hit) considerScored(state, imageData, hit.x, hit.y, map, s, s, "gemini", "sparkle", id, "unblend", hit.score, false);
      }
    }
    for (const id of VEO_MAP_IDS) {
      const packed = getPackedById(id);
      if (!packed) continue;
      const prep = prepTemplate(packed.map, packed.w, packed.h, false);
      if (!prep) continue;
      const region = brRegion(width, height, packed.w, packed.h);
      const hit = scanTemplate(luma, width, height, prep, region, step);
      if (hit) considerScored(state, imageData, hit.x, hit.y, packed.map, packed.w, packed.h, "gemini", "veo", id, "unblend", hit.score, false);
    }
  };

  const twoK = preferSmall;
  const needDense = twoK || !state.best || state.best.confidence < 0.82;
  if (needDense) runDense(twoK ? 2 : 3, twoK ? [48, 44, 36, 40] : sizes.slice(0, 4), denseIds);

  if (!state.best || state.best.confidence < 0.8) {
    const focus = state.best ? [state.best.size] : twoK ? [48, 36] : sizes.slice(0, 2);
    runDense(2, focus, denseIds.slice(0, 2));
  }

  if (state.best) refine(state, imageData);
  return state.best;
}

function searchDolaCorner(imageData: ImageData): Cand | null {
  const { width, height } = imageData;
  const corner = dolaCornerAsHit(imageData);
  const word = searchDolaWord(imageData);
  const luma = toLuma(imageData);
  const state: { best: Cand | null } = { best: null };
  if (corner) {
    considerScored(
      state,
      imageData,
      corner.x,
      corner.y,
      corner.map,
      corner.mapW,
      corner.mapH,
      "dola",
      "dola",
      "overlay",
      "fill",
      corner.confidence,
      false,
    );
  }
  if (word) {
    considerScored(
      state,
      imageData,
      word.x,
      word.y,
      word.map,
      word.mapW,
      word.mapH,
      "dola",
      "dola",
      word.mapId,
      "fill",
      word.confidence,
      false,
    );
  }

  const sizes: Array<[number, number]> = [
    [72, 16],
    [86, 18],
    [96, 20],
    [112, 24],
    [128, 28],
    [148, 32],
    [Math.max(64, Math.round(width * 0.13)), Math.max(14, Math.round(height * 0.02))],
    [Math.max(72, Math.round(width * 0.16)), Math.max(16, Math.round(height * 0.024))],
  ];
  for (const [tw, th] of sizes) {
    if (tw >= width || th >= height) continue;
    const map = getDolaWordmark(tw, th);
    const prep = prepTemplate(map, tw, th, false);
    if (!prep) continue;
    const region = {
      x0: Math.max(0, width - Math.round(Math.min(width * 0.42, tw + 80))),
      y0: Math.max(0, height - Math.round(Math.min(height * 0.16, th + 60))),
      x1: width,
      y1: height,
    };
    const hit = scanTemplate(luma, width, height, prep, region, 3);
    if (hit) considerScored(state, imageData, hit.x, hit.y, map, tw, th, "dola", "dola", `dolaWord${tw}x${th}`, "fill", hit.score, false);
  }

  if (state.best) refine(state, imageData);
  const hit = state.best;
  if (!hit) return corner ?? word;
  return { ...hit, method: "fill", engine: "dola", mapKind: "dola" };
}

type Cand = DetectionHit & { map: Float32Array };

function lightOnlyKind(kind: MapKind): boolean {
  return kind === "sparkle" || kind === "veo" || kind === "grok" || kind === "grokBanner";
}

function consider(
  state: { best: Cand | null },
  imageData: ImageData,
  x: number,
  y: number,
  map: Float32Array,
  tw: number,
  th: number,
  engine: Exclude<EngineId, "auto">,
  mapKind: MapKind,
  mapId: string,
  method: "unblend" | "fill",
): void {
  const { data, width, height } = imageData;
  const light = nccAt(data, width, height, x, y, map, tw, th, false);
  const dark = lightOnlyKind(mapKind) ? -1 : nccAt(data, width, height, x, y, map, tw, th, true);
  const invert = dark > light;
  const score = Math.max(light, dark);
  const current = state.best;
  if (!current || score > current.confidence) {
    const gain = estimateGain(data, width, x, y, map, tw, th, invert);
    state.best = {
      engine,
      confidence: score,
      size: Math.max(tw, th),
      x,
      y,
      gain,
      polarity: invert ? "dark" : "light",
      mapKind,
      mapId,
      mapW: tw,
      mapH: th,
      method,
      map,
    };
  }
}

function refine(state: { best: Cand | null }, imageData: ImageData): void {
  const hit = state.best;
  if (!hit || hit.confidence < 0.08) return;
  const map = hit.map;
  const tw = hit.mapW;
  const th = hit.mapH;
  const step = 2;
  const reach = 14;
  for (let dy = -reach; dy <= reach; dy += step) {
    for (let dx = -reach; dx <= reach; dx += step) {
      consider(state, imageData, hit.x + dx, hit.y + dy, map, tw, th, hit.engine, hit.mapKind, hit.mapId, hit.method);
    }
  }
  const refined = state.best;
  if (!refined) return;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      consider(state, imageData, refined.x + dx, refined.y + dy, map, tw, th, refined.engine, refined.mapKind, refined.mapId, refined.method);
    }
  }
}

function searchPacked(
  imageData: ImageData,
  engine: Exclude<EngineId, "auto">,
  kind: MapKind,
  mapIds: string[],
  hints: ReturnType<typeof catalogHints>,
  method: "unblend" | "fill",
): Cand | null {
  const state: { best: Cand | null } = { best: null };
  const { width, height } = imageData;

  for (const id of mapIds) {
    const packed = getPackedById(id);
    if (!packed) continue;
    const map = packed.map;
    const tw = packed.w;
    const th = packed.h;
    for (const hint of hints) {
      const sized = { ...hint, size: Math.max(tw, th), width: tw, height: th };
      const p = placementFromHint(width, height, sized);
      consider(state, imageData, p.x, p.y, map, tw, th, engine, kind, id, method);
    }
  }

  refine(state, imageData);
  return state.best;
}

function searchBanners(imageData: ImageData): Cand | null {
  const state: { best: Cand | null } = { best: null };
  const { width, height } = imageData;
  const banners = packedMaps("grokBanner");
  const margins = [8, 16, 20, 24, 32, 40, 48];

  for (const packed of banners) {
    const tw = packed.w;
    const th = packed.h;
    if (tw >= width || th >= height) continue;
    const xs = new Set<number>();
    for (const m of margins) {
      xs.add(m);
      xs.add(Math.max(0, width - tw - m));
    }
    const step = Math.max(10, Math.round(tw / 5));
    for (let x = 8; x <= width - tw - 8; x += step) xs.add(x);
    for (const m of margins) {
      const y = height - th - m;
      if (y < 0) continue;
      for (const x of xs) {
        if (x < 0 || x + tw > width) continue;
        consider(state, imageData, x, y, packed.map, tw, th, "banner", "grokBanner", packed.id, "fill");
      }
    }
  }
  refine(state, imageData);
  return state.best;
}

function searchGrokLockup(imageData: ImageData): Cand | null {
  const state: { best: Cand | null } = { best: null };
  const { width, height } = imageData;
  const sizes: Array<[number, number]> = [
    [72, 16],
    [88, 18],
    [104, 18],
    [120, 20],
    [136, 20],
    [52, 16],
    [64, 18],
    [72, 20],
    [80, 22],
    [88, 24],
    [96, 24],
    [96, 26],
    [108, 28],
    [112, 28],
    [120, 30],
    [125, 32],
    [128, 32],
    [129, 33],
    [140, 36],
  ];
  const margins = [6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32];

  for (const [tw, th] of sizes) {
    if (tw >= width || th >= height) continue;
    const map = getGrokLockup(tw, th);
    const id = `grokLock${tw}x${th}`;
    for (const m of margins) {
      const x = Math.max(0, width - tw - m);
      const y = Math.max(0, height - th - m);
      if (x + tw > width || y + th > height) continue;
      consider(state, imageData, x, y, map, tw, th, "grok", "grok", id, "fill");
    }
    if (state.best?.mapId === id) refine(state, imageData);
  }
  return state.best;
}

function toLockupBox(hit: Cand, imgW: number, imgH: number): Cand {
  const capH = Math.max(16, Math.round(imgH * 0.07));
  const capW = Math.max(36, Math.round(imgW * 0.2));
  const h = Math.min(capH, Math.max(16, hit.mapH));
  const w = Math.min(capW, Math.max(hit.mapW, Math.round(h * 3.6)));
  const mr = Math.max(4, Math.min(28, imgW - hit.x - hit.mapW));
  const mb = Math.max(4, Math.min(28, imgH - hit.y - hit.mapH));
  const x = Math.max(0, imgW - w - mr);
  const y = Math.max(0, imgH - h - mb);
  const mapW = Math.min(w, imgW - x);
  const mapH = Math.min(h, imgH - y);
  return {
    ...hit,
    x,
    y,
    mapW,
    mapH,
    mapId: "overlay",
    mapKind: "grok",
    method: "fill",
    size: Math.max(mapW, mapH),
    engine: "grok",
  };
}

function grokCornerAsHit(imageData: ImageData): Cand | null {
  const box = findGrokCornerMark(imageData);
  if (!box) return null;
  return {
    engine: "grok",
    confidence: Math.max(0.4, Math.min(0.92, box.score)),
    size: Math.max(box.width, box.height),
    x: box.x,
    y: box.y,
    gain: 1,
    polarity: "light",
    mapKind: "grok",
    mapId: "overlay",
    mapW: box.width,
    mapH: box.height,
    method: "fill",
    map: new Float32Array(Math.max(1, box.width * box.height)),
  };
}

function dolaCornerAsHit(imageData: ImageData): Cand | null {
  const box = findDolaCornerMark(imageData);
  if (!box) return null;
  return {
    engine: "dola",
    confidence: Math.max(0.42, Math.min(0.9, box.score)),
    size: Math.max(box.width, box.height),
    x: box.x,
    y: box.y,
    gain: 1,
    polarity: "light",
    mapKind: "dola",
    mapId: "overlay",
    mapW: box.width,
    mapH: box.height,
    method: "fill",
    map: new Float32Array(Math.max(1, box.width * box.height)),
  };
}

function searchGrokWord(imageData: ImageData): Cand | null {
  const state: { best: Cand | null } = { best: null };
  const { width, height } = imageData;
  const sizes: Array<[number, number]> = [
    [56, 18],
    [64, 20],
    [72, 22],
    [80, 24],
    [88, 26],
    [96, 28],
    [104, 30],
    [112, 32],
    [128, 36],
    [140, 40],
  ];
  const margins = [6, 10, 14, 18, 24, 32, 40, 48];

  for (const [tw, th] of sizes) {
    if (tw >= width || th >= height) continue;
    const map = getGrokWordmark(tw, th);
    for (const m of margins) {
      const p = { x: Math.max(0, width - tw - m), y: Math.max(0, height - th - m) };
      if (p.x + tw > width || p.y + th > height) continue;
      consider(state, imageData, p.x, p.y, map, tw, th, "grok", "grokBanner", `grokWord${tw}x${th}`, "fill");
    }
  }
  refine(state, imageData);
  return state.best;
}

function searchDolaWord(imageData: ImageData): Cand | null {
  const state: { best: Cand | null } = { best: null };
  const { width, height } = imageData;
  const sizes: Array<[number, number]> = [
    [72, 16],
    [80, 17],
    [86, 18],
    [90, 19],
    [96, 20],
    [104, 22],
    [112, 24],
    [128, 28],
    [148, 32],
    [168, 36],
    [192, 40],
    [220, 46],
    [260, 54],
  ];
  const margins = [10, 14, 16, 18, 20, 22, 24, 28, 32];

  for (const [tw, th] of sizes) {
    if (tw >= width || th >= height) continue;
    const map = getDolaWordmark(tw, th);
    const id = `dolaWord${tw}x${th}`;
    for (const m of margins) {
      const x = Math.max(0, width - tw - m);
      const y = Math.max(0, height - th - m);
      if (x + tw > width || y + th > height) continue;
      consider(state, imageData, x, y, map, tw, th, "dola", "dola", id, "fill");
    }
    if (state.best?.mapId === id) refine(state, imageData);
  }
  return state.best;
}

function overlayAsHit(imageData: ImageData, fromYRatio = 0.78, fromXRatio = 0.62): Cand | null {
  const boxes = findOverlayBoxes(imageData, { fromYRatio, fromXRatio });
  const box = pickBestOverlay(boxes, imageData.width, imageData.height);
  if (!box) return null;
  const w = imageData.width;
  const h = imageData.height;
  if (box.width * box.height > w * h * 0.03) return null;
  if (Math.max(box.width, box.height) > Math.min(w, h) * 0.34 && box.width / Math.max(1, box.height) < 2) return null;
  const dummy = new Float32Array(box.width * box.height);
  dummy.fill(0.55);
  const wide = box.width / Math.max(1, box.height) >= 1.8;
  return {
    engine: wide ? "banner" : "grok",
    confidence: Math.min(0.88, box.score / 90),
    size: Math.max(box.width, box.height),
    x: box.x,
    y: box.y,
    gain: 1,
    polarity: "light",
    mapKind: wide ? "grokBanner" : "grok",
    mapId: "overlay",
    mapW: box.width,
    mapH: box.height,
    method: "fill",
    map: dummy,
  };
}

function pickBestOverlay(boxes: OverlayBox[], w: number, h: number): OverlayBox | null {
  if (!boxes.length) return null;
  let best: OverlayBox | null = null;
  let bestScore = -1;
  for (const box of boxes) {
    const cornerBoost = isNearCorner(box, w, h) ? 1.35 : 1;
    const wideBoost = box.width / Math.max(1, box.height) >= 2 ? 1.15 : 1;
    const s = box.score * cornerBoost * wideBoost;
    if (s > bestScore) {
      bestScore = s;
      best = box;
    }
  }
  return best;
}

function isNearCorner(box: { x: number; y: number; width?: number; height?: number; mapW?: number; mapH?: number }, w: number, h: number): boolean {
  const bw = box.width ?? box.mapW ?? 0;
  const bh = box.height ?? box.mapH ?? 0;
  const nearX = box.x < w * 0.22 || box.x + bw > w * 0.78;
  const nearY = box.y + bh > h * 0.72 || box.y < h * 0.18;
  return nearX && nearY;
}

function searchKindProcedural(
  imageData: ImageData,
  kind: MapKind,
  engine: Exclude<EngineId, "auto">,
  hints: ReturnType<typeof catalogHints>,
): Cand | null {
  const state: { best: Cand | null } = { best: null };
  const tryAt = (x: number, y: number, size: number) => {
    const template = getAlphaMap(kind, size, size);
    consider(state, imageData, x, y, template, size, size, engine, kind, `${kind}${size}`, "unblend");
  };
  const { width, height } = imageData;
  for (const hint of hints) {
    const p = placementFromHint(width, height, hint);
    tryAt(p.x, p.y, hint.size);
  }
  refine(state, imageData);
  return state.best;
}

function better(a: Cand | null, b: Cand | null): Cand | null {
  if (!a) return b;
  if (!b) return a;
  return b.confidence > a.confidence ? b : a;
}

function stripMap(hit: Cand): DetectionHit {
  const { map: _map, ...rest } = hit;
  return rest;
}

function asBox(hit: { x: number; y: number; mapW: number; mapH: number }): ExtraBox {
  return { x: hit.x, y: hit.y, width: hit.mapW, height: hit.mapH };
}

function keepInteriorOverlay(box: OverlayBox, w: number, h: number): boolean {
  if (isNearCorner(box, w, h)) return true;
  const maxSide = Math.min(w, h) * 0.2;
  const aspect = box.width / Math.max(1, box.height);
  return box.width <= maxSide && box.height <= maxSide && aspect > 0.45 && aspect < 2.4;
}

function collectExtras(
  imageData: ImageData,
  primary: { x: number; y: number; mapW: number; mapH: number } | null,
  otherHits: Array<Cand | null>,
  fromYRatio = 0.48,
  opts?: { cornerWords?: boolean },
): ExtraBox[] {
  const { width: w, height: h } = imageData;
  const extras: ExtraBox[] = [];
  const primaryBox = primary
    ? { x: primary.x, y: primary.y, width: primary.mapW, height: primary.mapH }
    : null;

  const push = (box: ExtraBox) => {
    if (box.width < 6 || box.height < 6) return;
    if (box.width * box.height > w * h * 0.04) return;
    if (box.height > h * 0.12 && box.width / Math.max(1, box.height) < 2.2) return;
    if (primaryBox && boxesOverlap(primaryBox, box, 0.84)) {
      // Extends past the primary — keep the leftover strip rather than drop the text.
      const ux = Math.min(primaryBox.x, box.x);
      const uy = Math.min(primaryBox.y, box.y);
      const ux1 = Math.max(primaryBox.x + primaryBox.width, box.x + box.width);
      const uy1 = Math.max(primaryBox.y + primaryBox.height, box.y + box.height);
      const grown: ExtraBox = { x: ux, y: uy, width: ux1 - ux, height: uy1 - uy };
      if (grown.width * grown.height > primaryBox.width * primaryBox.height * 1.15) {
        if (!extras.some((e) => boxesOverlap(e, grown, 0.84))) extras.push(grown);
      }
      return;
    }
    if (extras.some((e) => boxesOverlap(e, box, 0.7))) return;
    extras.push({
      x: Math.round(box.x),
      y: Math.round(box.y),
      width: Math.round(box.width),
      height: Math.round(box.height),
    });
  };

  for (const hit of otherHits) {
    if (!hit || hit.confidence < 0.16) continue;
    push(asBox(hit));
  }

  const blobs = findOverlayBoxes(imageData, { fromYRatio });
  for (const box of blobs) {
    if (!keepInteriorOverlay(box, w, h)) continue;
    push(box);
  }

  if (opts?.cornerWords !== false) {
    const tw = Math.max(56, Math.round(w * 0.13));
    const th = Math.max(18, Math.round(h * 0.042));
    push({ x: w - tw - 6, y: h - th - 6, width: tw, height: th });
  }

  return extras.filter((b) => boxHasGlyph(imageData, b)).slice(0, 6);
}

function attachExtras(hit: DetectionHit, extras: ExtraBox[]): DetectionHit {
  return extras.length ? { ...hit, extras } : hit;
}

function preferCornerText(
  logo: Cand | null,
  word: Cand | null,
  banner: Cand | null,
  overlay: Cand | null,
  w: number,
  h: number,
): Cand | null {
  const maxMark = Math.min(w, h) * 0.32;
  const overlayOk =
    overlay && overlay.size <= maxMark && overlay.mapH <= h * 0.1 ? overlay : null;

  const cornerWord = [word, banner, overlayOk].reduce<Cand | null>((best, hit) => {
    if (!hit) return best;
    const wide = hit.mapW / Math.max(1, hit.mapH) >= 1.6;
    const corner = isNearCorner(hit, w, h);
    if (!wide && !corner) return best;
    if (hit.confidence < 0.16) return best;
    return better(best, hit);
  }, null);

  if (logo && !isNearCorner(logo, w, h)) {
    if (cornerWord && cornerWord.confidence >= 0.16) return cornerWord;
  }
  if (word && word.confidence >= 0.28 && isNearCorner(word, w, h)) {
    if (!logo || logo.confidence < word.confidence + 0.12) return word;
  }
  if (logo && isNearCorner(logo, w, h) && logo.confidence >= 0.55) {
    return better(logo, cornerWord && cornerWord.mapId !== "overlay" ? cornerWord : logo);
  }
  if (cornerWord && (!logo || cornerWord.confidence >= logo.confidence * 0.72 || logo.confidence < 0.5)) {
    return better(cornerWord, logo && isNearCorner(logo, w, h) ? logo : null) ?? cornerWord;
  }
  return better(better(logo, word), better(banner, overlayOk));
}

export function detectWatermark(imageData: ImageData, engine: EngineId): DetectionHit | null {
  const width = imageData.width;
  const height = imageData.height;

  const sparkleIds = [
    "diamond48",
    "diamond96",
    "diamond36",
    "sparkle48",
    "sparkle48soft",
    "sparkle36v2",
    "sparkle96",
    "sparkle96soft",
    "sparkle96new",
    "sparkle36",
  ];
  const veoIds = ["veo68", "veo99"];

  if (engine === "gemini") {
    const hit = searchGeminiCorner(imageData);
    if (!hit) return null;
    return stripMap(hit);
  }

  if (engine === "grok") {
    const corner = grokCornerAsHit(imageData);
    const lockup = searchGrokLockup(imageData);
    if (lockup && lockup.confidence >= 0.82) {
      return stripMap({ ...lockup, method: "fill" });
    }
    if (corner) return stripMap(corner);
    if (lockup && lockup.confidence >= 0.45) {
      return stripMap({ ...lockup, method: "fill", mapId: "overlay" });
    }
    const word = searchGrokWord(imageData);
    if (word && isNearCorner(word, width, height)) return stripMap(toLockupBox(word, width, height));
    return null;
  }

  if (engine === "banner") {
    const banner = searchBanners(imageData);
    const lockup = searchGrokLockup(imageData);
    const word = searchGrokWord(imageData);
    const hit = better(better(banner, lockup), word);
    return hit ? stripMap(hit) : null;
  }

  if (engine === "dola") {
    const hit = searchDolaCorner(imageData);
    return hit ? stripMap({ ...hit, method: "fill", engine: "dola" }) : null;
  }

  if (engine !== "auto") {
    const kind = mapKindForEngine(engine);
    const hints = catalogHints(width, height, engine);
    const hit = searchKindProcedural(imageData, kind, engine, hints);
    if (engine === "generic") {
      const overlay = overlayAsHit(imageData, 0.55);
      const pick = better(hit, overlay);
      if (!pick) return null;
      const extras = collectExtras(imageData, stripMap(pick), [hit, overlay], 0.55);
      return attachExtras(stripMap(pick), extras);
    }
    return hit ? stripMap(hit) : null;
  }

  const geminiHit = searchGeminiCorner(imageData);
  const dolaHit = searchDolaCorner(imageData);

  let best: Cand | null = null;
  if (geminiHit && geminiHit.confidence >= 0.28) best = geminiHit;
  if (dolaHit && dolaHit.confidence >= 0.5 && (!best || dolaHit.confidence >= (best.confidence || 0) * 0.9)) {
    best = better(best, dolaHit);
  }
  if (!best) best = geminiHit ?? dolaHit;
  if (!best) {
    const sparkle = searchPacked(imageData, "gemini", "sparkle", sparkleIds, catalogHints(width, height, "gemini"), "unblend");
    const veo = searchPacked(imageData, "gemini", "veo", veoIds, catalogHints(width, height, "gemini"), "unblend");
    best = better(sparkle, veo);
  }

  if (!best) return null;
  if (best.engine === "dola") return stripMap({ ...best, method: "fill" });
  return stripMap(best);
}

function residualLuma(imageData: ImageData): Float32Array {
  const luma = toLuma(imageData);
  const { width: w, height: h } = imageData;
  const tmp = new Float32Array(luma.length);
  const blur = new Float32Array(luma.length);
  const r = 6;
  const span = r * 2 + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += luma[y * w + Math.max(0, Math.min(w - 1, x))] ?? 0;
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / span;
      acc -= luma[y * w + Math.max(0, x - r)] ?? 0;
      acc += luma[y * w + Math.min(w - 1, x + r + 1)] ?? 0;
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.max(0, Math.min(h - 1, y)) * w + x] ?? 0;
    for (let y = 0; y < h; y++) {
      blur[y * w + x] = acc / span;
      acc -= tmp[Math.max(0, y - r) * w + x] ?? 0;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] ?? 0;
    }
  }
  const out = new Float32Array(luma.length);
  for (let i = 0; i < luma.length; i++) out[i] = (luma[i] ?? 0) - (blur[i] ?? 0);
  return out;
}

/** Veo clips: tiny BR 4-point sparkle. Photo detect is unchanged. */
function walkArm(
  residual: Float32Array,
  luma: Float32Array,
  w: number,
  h: number,
  x: number,
  y: number,
  dx: number,
  dy: number,
  peak: number,
  maxK = 18,
): number {
  let n = 0;
  const minR = Math.max(3.2, peak * 0.22);
  for (let k = 1; k <= maxK; k++) {
    const xx = x + dx * k;
    const yy = y + dy * k;
    if (xx < 1 || yy < 1 || xx >= w - 1 || yy >= h - 1) break;
    const r = residual[yy * w + xx] ?? 0;
    const lum = luma[yy * w + xx] ?? 0;
    if (r < minR || lum < 138) break;
    n = k;
    if (r < peak * 0.16 && k >= 3) break;
  }
  return n;
}

function measureCornerSparkleSpan(imageData: ImageData): number {
  const { width: w, height: h, data } = imageData;
  const residual = residualLuma(imageData);
  const luma = toLuma(imageData);
  const band = Math.min(Math.max(Math.round(Math.min(w, h) * 0.22), 72), 160);
  const x0 = Math.max(2, w - band);
  const y0 = Math.max(2, h - band);
  let peakX = w - 24;
  let peakY = h - 24;
  let peakV = -1e9;
  for (let y = y0; y < h - 2; y++) {
    for (let x = x0; x < w - 2; x++) {
      const r = residual[y * w + x] ?? 0;
      const lum = lumaAt(data, w, x, y);
      if (lum < 145) continue;
      if (r > peakV) {
        peakV = r;
        peakX = x;
        peakY = y;
      }
    }
  }
  if (peakV < 3) return 48;
  const dirs = [
    [0, -1],
    [0, 1],
    [1, 0],
    [-1, 0],
    [1, -1],
    [-1, -1],
    [1, 1],
    [-1, 1],
  ];
  let arm = 0;
  for (const [dx, dy] of dirs) {
    arm = Math.max(arm, walkArm(residual, luma, w, h, peakX, peakY, dx, dy, peakV, 48));
  }
  return Math.max(10, arm * 2 + 1);
}

function tightenToStarTips(
  imageData: ImageData,
  residual: Float32Array,
  luma: Float32Array,
  hit: Cand,
): Cand {
  const w = imageData.width;
  const h = imageData.height;
  const x0 = Math.max(2, hit.x - 4);
  const y0 = Math.max(2, hit.y - 4);
  const x1 = Math.min(w - 2, hit.x + hit.mapW + 4);
  const y1 = Math.min(h - 2, hit.y + hit.mapH + 4);
  let peakX = hit.x + (hit.mapW >> 1);
  let peakY = hit.y + (hit.mapH >> 1);
  let peakV = -1e9;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const r = residual[y * w + x] ?? 0;
      const lum = luma[y * w + x] ?? 0;
      if (lum < 148) continue;
      const score = r + (lum - 148) * 0.08;
      if (score > peakV) {
        peakV = score;
        peakX = x;
        peakY = y;
      }
    }
  }
  const peakR = residual[peakY * w + peakX] ?? 0;
  const n = walkArm(residual, luma, w, h, peakX, peakY, 0, -1, peakR);
  const s = walkArm(residual, luma, w, h, peakX, peakY, 0, 1, peakR);
  const e = walkArm(residual, luma, w, h, peakX, peakY, 1, 0, peakR);
  const west = walkArm(residual, luma, w, h, peakX, peakY, -1, 0, peakR);
  const ne = walkArm(residual, luma, w, h, peakX, peakY, 1, -1, peakR);
  const nw = walkArm(residual, luma, w, h, peakX, peakY, -1, -1, peakR);
  const se = walkArm(residual, luma, w, h, peakX, peakY, 1, 1, peakR);
  const sw = walkArm(residual, luma, w, h, peakX, peakY, -1, 1, peakR);
  const card = Math.max(n, s, e, west);
  const diag = Math.max(ne, nw, se, sw);
  const arm = Math.max(card, diag, 6);
  const half = arm + 1;
  const size = Math.max(12, Math.min(28, half * 2 + 1));
  const x = Math.max(0, Math.min(w - size, peakX - ((size / 2) | 0)));
  const y = Math.max(0, Math.min(h - size, peakY - ((size / 2) | 0)));
  const id = hit.mapId || "diamond36";
  const map = templateForSize(id, size, size) ?? hit.map;
  const arms = [n, s, e, west].filter((v) => v >= 3).length;
  const conf = Math.min(0.98, Math.max(hit.confidence, 0.9) + (arms >= 3 ? 0.05 : 0));
  return {
    ...hit,
    x,
    y,
    size,
    mapW: size,
    mapH: size,
    map,
    mapId: id,
    confidence: conf,
  };
}

function searchGeminiVideoSmall(imageData: ImageData): Cand | null {
  const { width, height, data } = imageData;
  if (width < 48 || height < 48) return null;
  const residual = residualLuma(imageData);
  const luma = toLuma(imageData);
  const state: { best: Cand | null } = { best: null };
  const sizes = [14, 16, 18, 20, 22, 24, 26];
  const ids = ["diamond36", "sparkle36v2", "sparkle36"];
  const short = Math.min(width, height);
  const band = Math.min(Math.max(Math.round(short * 0.14), 56), 96);
  const region = {
    x0: Math.max(0, width - band),
    y0: Math.max(0, height - band),
    x1: width,
    y1: height,
  };

  let peakX = -1;
  let peakY = -1;
  let peakV = 0;
  for (let y = region.y0 + 3; y < region.y1 - 3; y++) {
    for (let x = region.x0 + 3; x < region.x1 - 3; x++) {
      const v = residual[y * width + x] ?? 0;
      if (v <= peakV) continue;
      const lum = lumaAt(data, width, x, y);
      if (lum < 155) continue;
      peakV = v;
      peakX = x;
      peakY = y;
    }
  }

  const tryScan = (field: Float32Array, step: number, extraRegion?: { x0: number; y0: number; x1: number; y1: number }) => {
    const reg = extraRegion ?? region;
    for (const id of ids) {
      if (!getPackedById(id)) continue;
      for (const s of sizes) {
        const map = templateForSize(id, s, s);
        if (!map) continue;
        const prep = prepTemplate(map, s, s, false);
        if (!prep) continue;
        const hit = scanTemplate(field, width, height, prep, reg, step);
        if (!hit) continue;
        const nearEdge = hit.x + s > width - 6 && hit.y + s > height - 6;
        const boost = (nearEdge ? 0.05 : 0) + (s <= 22 ? 0.08 : s <= 24 ? 0.03 : -0.04);
        considerScored(state, imageData, hit.x, hit.y, map, s, s, "gemini", "sparkle", id, "unblend", hit.score + boost, false);
      }
    }
  };

  tryScan(residual, 1);
  if (peakX >= 0 && peakV > 3) {
    for (const s of sizes) {
      const x = Math.max(0, Math.min(width - s, peakX - (s / 2) | 0));
      const y = Math.max(0, Math.min(height - s, peakY - (s / 2) | 0));
      tryScan(residual, 1, {
        x0: Math.max(region.x0, x - 5),
        y0: Math.max(region.y0, y - 5),
        x1: Math.min(width, x + s + 5),
        y1: Math.min(height, y + s + 5),
      });
    }
  }

  if (!state.best) return null;
  refine(state, imageData);
  if (!state.best) return null;
  const tight = tightenToStarTips(imageData, residual, luma, state.best);
  if (tight.size > 30) return null;
  return tight;
}

export function detectWatermarkVideo(imageData: ImageData, engine: EngineId): DetectionHit | null {
  if (engine !== "auto" && engine !== "gemini") {
    return detectWatermark(imageData, engine);
  }
  const classic = searchGeminiCorner(imageData);
  if (classic && classic.size >= 36 && classic.confidence >= 0.4) {
    return stripMap(classic);
  }
  const span = measureCornerSparkleSpan(imageData);
  if (span >= 34) {
    if (classic) return stripMap(classic);
    return detectWatermark(imageData, engine);
  }
  const small = searchGeminiVideoSmall(imageData);
  if (small && small.size <= 28 && span <= 26 && (!classic || classic.confidence < 0.4)) {
    return stripMap(small);
  }
  if (classic) return stripMap(classic);
  return detectWatermark(imageData, engine);
}

export function fallbackHit(imageData: ImageData, engine: EngineId): DetectionHit {
  const id = engine === "auto" ? "gemini" : engine;
  const hint = defaultHint(imageData.width, imageData.height, id);
  const p = placementFromHint(imageData.width, imageData.height, hint);
  const kind = mapKindForEngine(id);
  if (id === "grok") {
    const box = findGrokCornerMark(imageData);
    const wImg = imageData.width;
    const hImg = imageData.height;
    const boxW = box?.width ?? Math.max(52, Math.round(wImg * 0.105));
    const boxH = box?.height ?? Math.max(16, Math.round(hImg * 0.026));
    return {
      engine: id,
      confidence: box ? Math.max(0.4, box.score) : 0,
      size: Math.max(boxW, boxH),
      x: box?.x ?? Math.max(0, wImg - boxW - 6),
      y: box?.y ?? Math.max(0, hImg - boxH - 6),
      gain: 1,
      polarity: "light",
      mapKind: "grok",
      mapId: "overlay",
      mapW: boxW,
      mapH: boxH,
      method: "fill",
    };
  }
  if (id === "dola") {
    const box = findDolaCornerMark(imageData);
    const wImg = imageData.width;
    const hImg = imageData.height;
    const boxW = box?.width ?? Math.max(64, Math.round(wImg * 0.13));
    const boxH = box?.height ?? Math.max(14, Math.round(hImg * 0.02));
    return {
      engine: id,
      confidence: box ? Math.max(0.4, box.score) : 0,
      size: Math.max(boxW, boxH),
      x: box?.x ?? Math.max(0, wImg - boxW - 20),
      y: box?.y ?? Math.max(0, hImg - boxH - 20),
      gain: 1,
      polarity: "light",
      mapKind: "dola",
      mapId: "overlay",
      mapW: boxW,
      mapH: boxH,
      method: "fill",
    };
  }
  const packed = packedMaps(kind)[0];
  if (id === "gemini") {
    const seed = geminiRatioSeeds(imageData.width, imageData.height)[0] ?? hint;
    const p2 = placementFromHint(imageData.width, imageData.height, seed);
    const gs = seed.size;
    const mapId = gs >= 72 ? "diamond96" : gs <= 40 ? "diamond36" : "diamond48";
    return {
      engine: id,
      confidence: 0,
      size: gs,
      x: p2.x,
      y: p2.y,
      gain: 1,
      polarity: "light",
      mapKind: "sparkle",
      mapId,
      mapW: gs,
      mapH: gs,
      method: "unblend",
    };
  }
  return {
    engine: id,
    confidence: 0,
    size: hint.size,
    x: p.x,
    y: p.y,
    gain: 1,
    polarity: "light",
    mapKind: kind,
    mapId: packed?.id ?? `${kind}${hint.size}`,
    mapW: packed?.w ?? hint.width ?? hint.size,
    mapH: packed?.h ?? hint.height ?? hint.size,
    method: "unblend",
  };
}

export function detectOverlays(imageData: ImageData) {
  return findOverlayBoxes(imageData);
}
