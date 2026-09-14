import type { EngineId } from "./types";

export type CatalogHint = {
  size: number;
  width?: number;
  height?: number;
  marginRight: number;
  marginBottom: number;
  marginLeft?: number;
  marginTop?: number;
  corner?: "br" | "bl" | "tr" | "tl";
};

const GEMINI_FIXED: Record<string, CatalogHint[]> = {
  "2752x1536": [{ size: 48, marginRight: 89, marginBottom: 89 }, { size: 48, marginRight: 96, marginBottom: 96 }, { size: 96, marginRight: 64, marginBottom: 64 }],
  "1536x2752": [
    { size: 48, marginRight: 89, marginBottom: 89 },
    { size: 48, marginRight: 96, marginBottom: 96 },
    { size: 48, marginRight: 80, marginBottom: 80 },
    { size: 36, marginRight: 89, marginBottom: 89 },
    { size: 36, marginRight: 96, marginBottom: 96 },
    { size: 36, marginRight: 64, marginBottom: 64 },
    { size: 44, marginRight: 89, marginBottom: 89 },
    { size: 96, marginRight: 64, marginBottom: 64 },
  ],
  "1408x768": [{ size: 46, marginRight: 32, marginBottom: 32 }, { size: 48, marginRight: 32, marginBottom: 32 }],
  "1024x1024": [{ size: 48, marginRight: 32, marginBottom: 32 }, { size: 96, marginRight: 64, marginBottom: 64 }],
  "1344x768": [{ size: 48, marginRight: 32, marginBottom: 32 }],
  "1536x1536": [{ size: 96, marginRight: 64, marginBottom: 64 }, { size: 96, marginRight: 192, marginBottom: 192 }],
  "2048x2048": [
    { size: 96, marginRight: 64, marginBottom: 64 },
    { size: 96, marginRight: 192, marginBottom: 192 },
    { size: 48, marginRight: 96, marginBottom: 96 },
  ],
  "2400x1792": [
    { size: 48, marginRight: 96, marginBottom: 96 },
    { size: 48, marginRight: 89, marginBottom: 89 },
    { size: 44, marginRight: 96, marginBottom: 96 },
    { size: 36, marginRight: 96, marginBottom: 96 },
    { size: 48, marginRight: 64, marginBottom: 64 },
  ],
  "1920x1080": [
    { size: 96, marginRight: 64, marginBottom: 64 },
    { size: 96, marginRight: 96, marginBottom: 96 },
    { size: 48, marginRight: 32, marginBottom: 32 },
    { size: 48, marginRight: 96, marginBottom: 96 },
  ],
  "1080x1920": [
    { size: 96, marginRight: 64, marginBottom: 64 },
    { size: 96, marginRight: 96, marginBottom: 96 },
    { size: 48, marginRight: 96, marginBottom: 96 },
    { size: 48, marginRight: 32, marginBottom: 32 },
  ],
  "1280x720": [
    { size: 48, marginRight: 96, marginBottom: 96 },
    { size: 48, marginRight: 32, marginBottom: 32 },
    { size: 44, marginRight: 96, marginBottom: 96 },
    { size: 36, marginRight: 96, marginBottom: 96 },
  ],
  "720x1280": [
    { size: 48, marginRight: 96, marginBottom: 96 },
    { size: 48, marginRight: 32, marginBottom: 32 },
    { size: 44, marginRight: 96, marginBottom: 96 },
    { size: 36, marginRight: 96, marginBottom: 96 },
  ],
  "896x1200": [{ size: 48, marginRight: 96, marginBottom: 96 }, { size: 36, marginRight: 96, marginBottom: 96 }],
  "1792x2400": [
    { size: 48, marginRight: 96, marginBottom: 96 },
    { size: 48, marginRight: 192, marginBottom: 192 },
    { size: 36, marginRight: 96, marginBottom: 96 },
    { size: 96, marginRight: 192, marginBottom: 192 },
    { size: 96, marginRight: 64, marginBottom: 64 },
  ],
  "1200x896": [{ size: 48, marginRight: 96, marginBottom: 96 }, { size: 36, marginRight: 96, marginBottom: 96 }],
  "2816x1536": [{ size: 96, marginRight: 192, marginBottom: 192 }],
  "768x1376": [{ size: 48, marginRight: 96, marginBottom: 96 }, { size: 36, marginRight: 64, marginBottom: 64 }],
  "1376x768": [{ size: 48, marginRight: 96, marginBottom: 96 }, { size: 36, marginRight: 64, marginBottom: 64 }],
};

export function isGeminiNativeSize(width: number, height: number): boolean {
  return Boolean(GEMINI_FIXED[`${width}x${height}`]);
}

export type GeminiCanon = { w: number; h: number; family: "080" | "048" };

/** Native Gemini stills we already tuned. Resized WhatsApp/email copies scale from these. */
const GEMINI_CANON: GeminiCanon[] = [
  { w: 896, h: 1200, family: "080" },
  { w: 1792, h: 2400, family: "080" },
  { w: 1024, h: 1024, family: "080" },
  { w: 1200, h: 896, family: "080" },
  { w: 2400, h: 1792, family: "080" },
  { w: 768, h: 1376, family: "048" },
  { w: 1536, h: 2752, family: "048" },
  { w: 2048, h: 2048, family: "048" },
  { w: 1536, h: 1536, family: "048" },
  { w: 1376, h: 768, family: "048" },
  { w: 2752, h: 1536, family: "048" },
];

function aspectDelta(w1: number, h1: number, w2: number, h2: number) {
  const a = w1 / Math.max(1, h1);
  const b = w2 / Math.max(1, h2);
  return Math.abs(a - b) / Math.max(b, 1e-6);
}

export function nearestGeminiCanon(width: number, height: number): { canon: GeminiCanon; scale: number } | null {
  let best: { canon: GeminiCanon; scale: number; score: number } | null = null;
  for (const c of GEMINI_CANON) {
    if (aspectDelta(width, height, c.w, c.h) > 0.05) continue;
    const scale = (width / c.w + height / c.h) / 2;
    if (scale < 0.38 || scale > 1.25) continue;
    const score = Math.abs(Math.log(scale)) + aspectDelta(width, height, c.w, c.h);
    if (!best || score < best.score) best = { canon: c, scale, score };
  }
  return best ? { canon: best.canon, scale: best.scale } : null;
}

/** Map a native Gemini layout onto a compressed/resized copy (1600×1600 from 2048, etc.).
 *  Never remix other canons onto a size we already tuned — those stay exact. */
export function scaledFixedHints(width: number, height: number): CatalogHint[] {
  if (GEMINI_FIXED[`${width}x${height}`]) return [];
  const out: CatalogHint[] = [];
  for (const c of GEMINI_CANON) {
    if (aspectDelta(width, height, c.w, c.h) > 0.05) continue;
    const scale = (width / c.w + height / c.h) / 2;
    if (scale < 0.38 || scale > 1.25) continue;
    if (Math.abs(scale - 1) < 0.006) continue;
    const base = GEMINI_FIXED[`${c.w}x${c.h}`];
    if (!base) continue;
    for (const hint of base) {
      const size = Math.max(24, Math.round(hint.size * scale));
      const mr = Math.max(4, Math.round(hint.marginRight * scale));
      const mb = Math.max(4, Math.round(hint.marginBottom * scale));
      out.push({ size, marginRight: mr, marginBottom: mb, corner: "br" });
      out.push({ size: size + 2, marginRight: mr, marginBottom: mb, corner: "br" });
      out.push({ size: Math.max(24, size - 2), marginRight: mr, marginBottom: mb, corner: "br" });
      out.push({ size, marginRight: mr + 4, marginBottom: mb + 4, corner: "br" });
      out.push({ size, marginRight: Math.max(4, mr - 4), marginBottom: Math.max(4, mb - 4), corner: "br" });
    }
  }
  return out;
}

export type RatioKind = "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "3:2" | "2:3" | "21:9" | "other";

export function classifyRatio(width: number, height: number): RatioKind {
  const r = width / Math.max(1, height);
  const candidates: Array<[RatioKind, number]> = [
    ["16:9", 16 / 9],
    ["9:16", 9 / 16],
    ["1:1", 1],
    ["4:3", 4 / 3],
    ["3:4", 3 / 4],
    ["3:2", 3 / 2],
    ["2:3", 2 / 3],
    ["21:9", 21 / 9],
  ];
  let best: RatioKind = "other";
  let bestErr = 0.08;
  for (const [name, target] of candidates) {
    const err = Math.abs(r - target) / target;
    if (err < bestErr) {
      bestErr = err;
      best = name;
    }
  }
  return best;
}

/** Gemini 3.x 2K stills (1536×2752 / 2752×1536) keep a SMALL 48px mark, not 96. */
export function isGemini2kStill(width: number, height: number): boolean {
  const a = Math.min(width, height);
  const b = Math.max(width, height);
  return a >= 1480 && a <= 1600 && b >= 2650 && b <= 2850;
}

export function isGemini34Still(width: number, height: number): boolean {
  const ratio = classifyRatio(width, height);
  return ratio === "3:4" || ratio === "4:3";
}

export function isGemini43_2k(width: number, height: number): boolean {
  return width === 2400 && height === 1792;
}

function pushHint(list: CatalogHint[], size: number, margin: number) {
  if (size < 24 || margin < 4) return;
  list.push({ size, marginRight: margin, marginBottom: margin, corner: "br" });
}

/** Official + ratio-family seeds. Gemini always sits BR; size/margin change with ratio. */
export function geminiRatioSeeds(width: number, height: number): CatalogHint[] {
  const ratio = classifyRatio(width, height);
  const short = Math.min(width, height);
  const bothLarge = width > 1024 && height > 1024;
  const seeds: CatalogHint[] = [];

  if (isGemini2kStill(width, height)) {
    for (const m of [89, 96, 80, 72, 64, 104, 112, 128, 192]) {
      pushHint(seeds, 48, m);
      pushHint(seeds, 44, m);
      pushHint(seeds, 36, m);
      pushHint(seeds, 40, m);
    }
    pushHint(seeds, 96, 64);
    pushHint(seeds, 96, 192);
    return seeds;
  }

  if (isGemini43_2k(width, height)) {
    for (const m of [96, 89, 80, 64, 72, 112, 192]) {
      pushHint(seeds, 48, m);
      pushHint(seeds, 44, m);
      pushHint(seeds, 36, m);
    }
    return seeds;
  }

  if (bothLarge) {
    pushHint(seeds, 96, 64);
    pushHint(seeds, 96, 192);
    pushHint(seeds, 96, 96);
    pushHint(seeds, 96, 48);
    pushHint(seeds, 48, 96);
  } else {
    pushHint(seeds, 48, 32);
    pushHint(seeds, 48, 96);
    pushHint(seeds, 36, 32);
    pushHint(seeds, 36, 96);
    pushHint(seeds, 48, 24);
    pushHint(seeds, 44, 96);
  }

  if (ratio === "16:9" || ratio === "9:16") {
    if (short >= 1000) {
      pushHint(seeds, 96, 64);
      pushHint(seeds, 96, 96);
      pushHint(seeds, 96, 48);
      pushHint(seeds, 80, 64);
    }
    if (short >= 600 && short <= 1200) {
      pushHint(seeds, 48, 96);
      pushHint(seeds, 48, 32);
      pushHint(seeds, 44, 96);
      pushHint(seeds, 36, 96);
      pushHint(seeds, 36, 64);
    }
  }

  if (ratio === "1:1") {
    if (short <= 1100) {
      pushHint(seeds, 48, 32);
      pushHint(seeds, 36, 32);
      pushHint(seeds, 48, 48);
    } else {
      pushHint(seeds, 96, 64);
      pushHint(seeds, 96, 192);
      pushHint(seeds, 96, 96);
    }
  }

  if (ratio === "3:2" || ratio === "2:3") {
    pushHint(seeds, 48, 32);
    pushHint(seeds, 48, 96);
    pushHint(seeds, 96, 64);
  }

  if (ratio === "21:9") {
    pushHint(seeds, 48, 32);
    pushHint(seeds, 96, 64);
  }

  const relSize = Math.max(32, Math.min(96, Math.round(short / 15)));
  const relMargin = Math.max(16, Math.round(short / 10));
  pushHint(seeds, relSize, relMargin);
  pushHint(seeds, 48, Math.round(short * 0.075));
  pushHint(seeds, 36, Math.round(short * 0.075));
  pushHint(seeds, 96, Math.round(short * 0.06));
  pushHint(seeds, 48, Math.round(short * 0.1));
  pushHint(seeds, 96, Math.round(short * 0.1));

  return seeds;
}

export function geminiPredictedSizes(width: number, height: number): number[] {
  const short = Math.min(width, height);
  const bothLarge = width > 1024 && height > 1024;
  const sizes = new Set<number>();
  const scaled = scaledFixedHints(width, height);
  for (const h of scaled) sizes.add(h.size);
  if (isGemini2kStill(width, height)) {
    [48, 44, 40, 36, 52, 56].forEach((s) => sizes.add(s));
  } else if (isGemini43_2k(width, height)) {
    [48, 44, 40, 36, 52].forEach((s) => sizes.add(s));
  } else if (bothLarge) {
    [96, 80, 72, 64, 48].forEach((s) => sizes.add(s));
  } else if (short <= 900) {
    [36, 40, 44, 48, 52].forEach((s) => sizes.add(s));
  } else {
    [48, 44, 36, 56, 64, 96].forEach((s) => sizes.add(s));
  }
  sizes.add(Math.max(32, Math.min(96, Math.round(short / 15))));
  return [...sizes];
}

export function catalogHints(width: number, height: number, engine: EngineId): CatalogHint[] {
  const key = `${width}x${height}`;
  const hints: CatalogHint[] = [];
  const minSide = Math.min(width, height);
  const maxSide = Math.max(width, height);

  if (engine === "gemini" || engine === "auto") {
    const fixed = GEMINI_FIXED[key];
    if (fixed) hints.push(...fixed);
    hints.push(...scaledFixedHints(width, height));
    hints.push(...geminiRatioSeeds(width, height));
    const sizes = geminiPredictedSizes(width, height);
    const margins = [16, 24, 32, 48, 64, 80, 96, 112, 128, 160, 192];
    for (const size of sizes) {
      for (const m of margins) {
        hints.push({ size, marginRight: m, marginBottom: m, corner: "br" });
      }
    }
    if (maxSide >= 1800) hints.push({ size: 96, marginRight: 192, marginBottom: 192 });
  }

  if (engine === "grok" || engine === "auto") {
    for (const h of [16, 18, 20, 22, 24, 28, 32]) {
      const w = Math.round(h * 3.6);
      for (const m of [6, 8, 10, 12, 16, 20, 24]) {
        hints.push({ size: h, width: w, height: h, marginRight: m, marginBottom: m, corner: "br" });
      }
    }
  }

  if (engine === "banner" || engine === "auto" || engine === "grok") {
    for (const m of [8, 12, 16, 24, 32]) {
      hints.push({ size: 28, width: 96, height: 28, marginRight: m, marginBottom: m, corner: "br" });
      hints.push({ size: 24, width: 80, height: 24, marginRight: m, marginBottom: m, corner: "br" });
      hints.push({ size: 36, width: 128, height: 36, marginRight: m, marginBottom: m, corner: "br" });
    }
  }

  if (engine === "banner" || engine === "auto") {
    for (const m of [12, 16, 24, 32, 40]) {
      hints.push({ size: 52, width: 201, height: 52, marginLeft: m, marginBottom: m, marginRight: 0, corner: "bl" });
      hints.push({ size: 52, width: 201, height: 52, marginRight: m, marginBottom: m, corner: "br" });
    }
  }

  if (engine === "dola" || engine === "auto") {
    for (const h of [16, 18, 20, 22, 24, 26, 28]) {
      const w = Math.round(h * 4.8);
      for (const m of [12, 16, 18, 20, 22, 24, 28, 32]) {
        hints.push({ size: h, width: w, height: h, marginRight: m, marginBottom: m, corner: "br" });
      }
    }
  }

  if (engine === "midjourney" || engine === "auto") {
    const s = minSide <= 900 ? 96 : 128;
    hints.push({ size: s, marginRight: 16, marginBottom: 16 });
    hints.push({ size: s, marginRight: 24, marginBottom: 24 });
  }

  if (engine === "chatgpt" || engine === "sora" || engine === "flux" || engine === "ideogram" || engine === "auto") {
    const s = minSide <= 1024 ? 48 : 72;
    hints.push({ size: s, marginRight: 20, marginBottom: 20 });
    hints.push({ size: s, marginRight: 12, marginBottom: 12 });
    hints.push({ size: s, marginRight: 32, marginBottom: 32 });
  }

  if (engine === "generic" || engine === "auto") {
    hints.push({ size: 48, marginRight: 24, marginBottom: 24 });
    hints.push({ size: 64, marginRight: 24, marginBottom: 24 });
    hints.push({ size: 96, marginRight: 16, marginBottom: 16 });
  }

  const seen = new Set<string>();
  return hints.filter((h) => {
    const ww = h.width ?? h.size;
    const hh = h.height ?? h.size;
    const k = `${h.corner ?? "br"}:${ww}x${hh}:${h.marginRight}:${h.marginBottom}:${h.marginLeft ?? 0}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return ww <= width && hh <= height;
  });
}

export function defaultHint(width: number, height: number, engine: EngineId): CatalogHint {
  const list = catalogHints(width, height, engine);
  return list[0] ?? { size: 48, marginRight: 32, marginBottom: 32 };
}

export function placementFromHint(width: number, height: number, hint: CatalogHint) {
  const w = hint.width ?? hint.size;
  const h = hint.height ?? hint.size;
  const corner = hint.corner ?? "br";
  const ml = hint.marginLeft ?? hint.marginRight;
  const mt = hint.marginTop ?? hint.marginBottom;
  let x = Math.max(0, width - w - hint.marginRight);
  let y = Math.max(0, height - h - hint.marginBottom);
  if (corner === "bl") {
    x = Math.max(0, ml);
    y = Math.max(0, height - h - hint.marginBottom);
  } else if (corner === "tr") {
    x = Math.max(0, width - w - hint.marginRight);
    y = Math.max(0, mt);
  } else if (corner === "tl") {
    x = Math.max(0, ml);
    y = Math.max(0, mt);
  }
  return { x, y, width: w, height: h };
}
