import { defaultHint, placementFromHint } from "./catalog";
import { cloneImageData, forwardBlend } from "./blend";
import type { MapKind } from "./types";

function hash2(x: number, y: number) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function noise(x: number, y: number) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0);
  const b = hash2(x0 + 1, y0);
  const c = hash2(x0, y0 + 1);
  const d = hash2(x0 + 1, y0 + 1);
  return a + (b - a) * ux + (c - a) * uy + (a + d - b - c) * ux * uy;
}

function fbm(x: number, y: number) {
  return noise(x, y) * 0.55 + noise(x * 2.1, y * 2.1) * 0.28 + noise(x * 4.3, y * 4.3) * 0.17;
}

function paintScene(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.62);
  sky.addColorStop(0, "#8ec5ff");
  sky.addColorStop(0.45, "#c9dff8");
  sky.addColorStop(1, "#efe6d2");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = "#f4d59a";
  ctx.beginPath();
  ctx.arc(w * 0.78, h * 0.22, Math.min(w, h) * 0.08, 0, Math.PI * 2);
  ctx.fill();

  const drawHill = (base: number, amp: number, color: string, seed: number) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 4) {
      const y = base + Math.sin(x * 0.01 + seed) * amp + fbm(x * 0.02 + seed, seed) * amp * 0.8;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  };

  drawHill(h * 0.5, 28, "#7d9a6a", 2.2);
  drawHill(h * 0.58, 22, "#5f864e", 4.8);
  drawHill(h * 0.68, 18, "#3f5c32", 1.1);

  const grass = ctx.getImageData(0, 0, w, h);
  const d = grass.data;
  for (let y = Math.floor(h * 0.55); y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const n = fbm(x * 0.08, y * 0.1);
      const blade = (hash2(x, y * 3) - 0.5) * 18;
      const shade = x > w * 0.62 && y > h * 0.62 ? -28 : 0;
      d[i] = Math.max(0, Math.min(255, (d[i] ?? 0) + n * 22 + blade + shade));
      d[i + 1] = Math.max(0, Math.min(255, (d[i + 1] ?? 0) + n * 16 + blade * 0.6 + shade * 0.8));
      d[i + 2] = Math.max(0, Math.min(255, (d[i + 2] ?? 0) + n * 8 + shade * 0.5));
    }
  }
  ctx.putImageData(grass, 0, 0);

  ctx.fillStyle = "#d9c4a3";
  ctx.beginPath();
  ctx.moveTo(0, h * 0.82);
  ctx.quadraticCurveTo(w * 0.4, h * 0.72, w, h * 0.86);
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.fill();
}

export function buildSampleImage(kind: MapKind = "sparkle", width = 1024, height = 1024): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas is not available.");
  paintScene(ctx, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  const engine = kind === "sparkle" ? "gemini" : kind === "grok" ? "grok" : kind === "grokBanner" ? "banner" : "dola";
  const hint = defaultHint(width, height, engine);
  const place = placementFromHint(width, height, hint);
  if (kind === "grok") {
    const lockH = Math.max(24, Math.round(height * 0.032));
    const lockW = Math.round(lockH * 3.9);
    place.width = lockW;
    place.height = lockH;
    place.x = Math.max(0, width - lockW - 16);
    place.y = Math.max(0, height - lockH - 16);
    forwardBlend(imageData, place, "grok", 1, 255, "grokLockup");
    return cloneImageData(imageData);
  }
  if (kind === "dola") {
    const lockH = Math.max(18, Math.round(height * 0.02));
    const lockW = Math.round(lockH * 4.8);
    place.width = lockW;
    place.height = lockH;
    place.x = Math.max(0, width - lockW - 22);
    place.y = Math.max(0, height - lockH - 22);
    forwardBlend(imageData, place, "dola", 1, 255, "dolaWordmark");
    return cloneImageData(imageData);
  }
  const mapId = kind === "sparkle" ? "sparkle48" : kind === "grokBanner" ? "grokImagine" : undefined;
  if (kind === "grokBanner") {
    const packedW = 201;
    const packedH = 52;
    place.width = packedW;
    place.height = packedH;
    place.x = 24;
    place.y = height - packedH - 24;
  }
  forwardBlend(imageData, place, kind, 1, 255, mapId);
  return cloneImageData(imageData);
}

export function sampleFileName(kind: MapKind) {
  if (kind === "grok") return "sample-grok.png";
  if (kind === "grokBanner") return "sample-imagine.png";
  if (kind === "dola") return "sample-dola.png";
  return "sample-gemini.png";
}
