import { cloneImageData, reverseBlendAndHeal, trimBlackBars } from "./blend";
import { getDolaWordmark } from "./alpha-maps";
import { isGeminiNativeSize, nearestGeminiCanon } from "./catalog";
import { detectWatermark, detectWatermarkVideo, fallbackHit } from "./detect";
import { blurGrokLockup, eraseDolaWordmark, magicVanish, maskFromAlpha, textureHeal } from "./inpaint";
import type { DetectParams, DetectionHit, EngineId, MapKind, Placement } from "./types";
import { GEMINI_1600_GAIN, GEMINI_34_GAIN, GEMINI_DEFAULT_GAIN, GROK_DEFAULT_GAIN, mapKindForEngine, usesFill } from "./types";

export async function imageDataFromFile(file: Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas is not available in this browser.");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export async function imageDataFromSource(source: CanvasImageSource, w: number, h: number): Promise<ImageData> {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas is not available in this browser.");
  ctx.drawImage(source, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

export function canvasFromImageData(imageData: ImageData): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser.");
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

export function blobFromImageData(imageData: ImageData, type: string, quality?: number): Promise<Blob> {
  const canvas = canvasFromImageData(imageData);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not encode image."));
      },
      type,
      quality,
    );
  });
}

function isGeminiHit(hit: DetectionHit): boolean {
  return hit.engine === "gemini" || hit.mapKind === "sparkle" || hit.mapKind === "veo";
}

function isGrokHit(hit: DetectionHit): boolean {
  return hit.engine === "grok" || hit.engine === "banner" || hit.mapKind === "grok" || hit.mapKind === "grokBanner";
}

function isDolaHit(hit: DetectionHit): boolean {
  return hit.engine === "dola" || hit.mapKind === "dola";
}

function geminiUses080(width: number, height: number): boolean {
  if (width === 896 && height === 1200) return true;
  if (width === 1792 && height === 2400) return true;
  if (width === 1024 && height === 1024) return true;
  if (width === 1200 && height === 896) return true;
  if (width === 2400 && height === 1792) return true;
  if (isGeminiNativeSize(width, height)) return false;
  const near = nearestGeminiCanon(width, height);
  return near?.canon.family === "080";
}

export function paramsFromHit(hit: DetectionHit, frame?: { width: number; height: number }): DetectParams {
  const gemini = isGeminiHit(hit);
  const grok = isGrokHit(hit);
  const dola = isDolaHit(hit);
  const fill = hit.method === "fill" || usesFill(hit.mapKind, hit.engine);
  const geminiGain =
    gemini && frame && frame.width === 1600 && frame.height === 1600
      ? GEMINI_1600_GAIN
      : gemini && frame && geminiUses080(frame.width, frame.height)
        ? GEMINI_34_GAIN
        : GEMINI_DEFAULT_GAIN;
  return {
    engine: hit.engine,
    gain: gemini
      ? geminiGain
      : fill
        ? 1
        : grok || dola
          ? Math.round((hit.confidence >= 0.55 ? Math.max(0.5, Math.min(1.05, hit.gain || GROK_DEFAULT_GAIN)) : GROK_DEFAULT_GAIN) * 100) / 100
          : Math.round(hit.gain * 100) / 100,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    size: hit.size,
    anchorX: hit.x,
    anchorY: hit.y,
    darkOutline: gemini,
    heal: fill ? 1 : gemini ? 0.55 : grok || dola ? 1 : 0.7,
    mapId: hit.mapId,
    mapW: hit.mapW,
    mapH: hit.mapH,
    extras: hit.extras,
  };
}

export function placementFromParams(params: DetectParams): Placement {
  const baseW = params.mapW ?? params.size;
  const baseH = params.mapH ?? params.size;
  return {
    x: Math.round(params.anchorX + params.offsetX),
    y: Math.round(params.anchorY + params.offsetY),
    width: Math.max(8, Math.round(baseW * params.scale)),
    height: Math.max(8, Math.round(baseH * params.scale)),
  };
}

/** Box actually painted by the fill path. Gain > 1 grows it (live preview); gain < 1 shrinks. */
export function fillBoxFromParams(params: DetectParams, imgW: number, imgH: number) {
  const placement = placementFromParams(params);
  if (params.engine === "grok" || params.engine === "banner") {
    const x = Math.max(0, placement.x);
    const y = Math.max(0, placement.y);
    const width = Math.max(8, Math.min(imgW - x, placement.width));
    const height = Math.max(6, Math.min(imgH - y, placement.height));
    return { x, y, width, height, score: 1 };
  }
  const grow = Math.round(Math.max(0, (params.gain - 1) * 20));
  const shrink = params.gain < 1 ? Math.round((1 - params.gain) * 6) : 0;
  let x = Math.max(0, placement.x - 3 - grow + shrink);
  let y = Math.max(0, placement.y - 2 - Math.round(grow * 0.35) + shrink);
  let width = placement.width + 6 + grow * 2 - shrink * 2;
  let height = placement.height + 4 + Math.round(grow * 1.5) - shrink * 2;
  width = Math.max(8, Math.min(imgW - x, width));
  height = Math.max(8, Math.min(imgH - y, height));
  return { x, y, width, height, score: 1 };
}

export function applyRemoval(
  original: ImageData,
  params: DetectParams,
  mapKind?: MapKind,
  polarity?: "light" | "dark",
  extras?: { fillBanners?: boolean },
): ImageData {
  const out = cloneImageData(original);
  const placement = placementFromParams(params);
  const kind =
    mapKind ?? (params.engine === "auto" ? "sparkle" : mapKindForEngine(params.engine));
  const methodFill = usesFill(kind, params.engine) || params.mapId === "overlay";
  const isGrok = kind === "grok" || kind === "grokBanner" || params.engine === "grok" || params.engine === "banner";
  const isDola = kind === "dola" || params.engine === "dola";

  if (methodFill) {
    const box = fillBoxFromParams(params, out.width, out.height);
    if (isGrok || isDola) {
      if (isDola) eraseDolaWordmark(out, box);
      else blurGrokLockup(out, box);
      if (isDola) {
        const map = getDolaWordmark(placement.width, placement.height);
        const extra = maskFromAlpha(
          out.width,
          out.height,
          placement.x,
          placement.y,
          map,
          placement.width,
          placement.height,
          0.08,
        );
        textureHeal(out, extra);
        eraseDolaWordmark(out, box);
      }
      if (params.gain < 0.995 || (params.heal ?? 1) < 0.995) {
        const t = Math.max(0, Math.min(1, Math.min(params.gain < 1 ? params.gain : 1, params.heal ?? 1)));
        const src = original.data;
        const dst = out.data;
        const x0 = box.x;
        const y0 = box.y;
        const x1 = Math.min(out.width, box.x + box.width);
        const y1 = Math.min(out.height, box.y + box.height);
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = (y * out.width + x) * 4;
            dst[i] = Math.round((src[i] ?? 0) * (1 - t) + (dst[i] ?? 0) * t);
            dst[i + 1] = Math.round((src[i + 1] ?? 0) * (1 - t) + (dst[i + 1] ?? 0) * t);
            dst[i + 2] = Math.round((src[i + 2] ?? 0) * (1 - t) + (dst[i + 2] ?? 0) * t);
          }
        }
      }
    } else {
      magicVanish(out, [box], Math.max(0.85, params.heal || 1), false);
    }
  } else {
    reverseBlendAndHeal(out, placement, {
      gain: params.gain,
      mapKind: kind,
      mapId: params.mapId,
      darkOutline: params.darkOutline,
      polarity,
      heal: params.heal,
    });
  }

  return out;
}

export function detectAndParams(original: ImageData, engine: EngineId): { hit: DetectionHit; params: DetectParams } {
  const hit = detectWatermark(original, engine) ?? fallbackHit(original, engine);
  return { hit, params: paramsFromHit(hit, original) };
}

function sceneLumaAround(imageData: ImageData, hit: DetectionHit): number {
  const { data, width: W, height: H } = imageData;
  const bw = Math.max(8, hit.mapW ?? hit.size);
  const bh = Math.max(8, hit.mapH ?? hit.size);
  const x0 = Math.max(0, hit.x);
  const y0 = Math.max(0, hit.y);
  const x1 = Math.min(W, x0 + bw);
  const y1 = Math.min(H, y0 + bh);
  const pad = Math.max(8, Math.round(Math.max(bw, bh) * 0.4));
  const rx0 = Math.max(0, x0 - pad);
  const ry0 = Math.max(0, y0 - pad);
  const rx1 = Math.min(W, x1 + pad);
  const ry1 = Math.min(H, y1 + pad);
  let sum = 0;
  let n = 0;
  for (let y = ry0; y < ry1; y++) {
    for (let x = rx0; x < rx1; x++) {
      if (x >= x0 && x < x1 && y >= y0 && y < y1) continue;
      const i = (y * W + x) * 4;
      const lum = ((data[i] ?? 0) * 2 + (data[i + 1] ?? 0) * 3 + (data[i + 2] ?? 0)) / 6;
      if (lum > 228) continue;
      sum += lum;
      n++;
    }
  }
  return n ? sum / n : 128;
}

export function detectAndParamsForMedia(
  original: ImageData,
  engine: EngineId,
  media: "image" | "video",
): { hit: DetectionHit; params: DetectParams } {
  const classic = detectAndParams(original, engine);
  if (media !== "video") return classic;
  if (!isGeminiHit(classic.hit) || classic.hit.size >= 36 || classic.hit.confidence >= 0.45) {
    if (isGeminiHit(classic.hit) && classic.hit.size >= 36) {
      const light = sceneLumaAround(original, classic.hit) >= 138;
      if (light) {
        return { hit: classic.hit, params: { ...classic.params, gain: GEMINI_1600_GAIN } };
      }
    }
    return classic;
  }
  const hit = detectWatermarkVideo(original, engine) ?? classic.hit;
  if (!isGeminiHit(hit) || hit.size > 28) return classic;
  return {
    hit,
    params: {
      ...paramsFromHit(hit, original),
      gain: GEMINI_1600_GAIN,
      darkOutline: false,
      heal: 0.95,
      anchorX: hit.x,
      anchorY: hit.y,
      size: hit.size,
      mapW: hit.mapW ?? hit.size,
      mapH: hit.mapH ?? hit.size,
    },
  };
}

export function maybeTrim(imageData: ImageData, enabled: boolean): ImageData {
  return enabled ? trimBlackBars(imageData) : imageData;
}
