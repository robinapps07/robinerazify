import { getAlphaMap, getAlphaMapById } from "./alpha-maps";
import { colorPreserveFill, maskFromAlpha, maskFromBoxes, type OverlayBox } from "./inpaint";
import type { MapKind, Placement } from "./types";

const ALPHA_THRESHOLD = 0.002;
const MAX_ALPHA = 0.99;

export type BlendOptions = {
  gain: number;
  mapKind: MapKind;
  mapId?: string;
  darkOutline: boolean;
  polarity?: "light" | "dark";
  heal?: number;
};

function resolveMap(placement: Placement, options: BlendOptions): Float32Array {
  const { width, height } = placement;
  if (options.mapId) {
    const byId = getAlphaMapById(options.mapId, width, height);
    if (byId) return byId;
  }
  return getAlphaMap(options.mapKind, width, height);
}

export function reverseBlend(imageData: ImageData, placement: Placement, options: BlendOptions): void {
  const { x, y, width, height } = placement;
  if (width < 2 || height < 2) return;
  const imgW = imageData.width;
  const imgH = imageData.height;
  const data = imageData.data;
  const map = resolveMap(placement, options);

  const gain = Number.isFinite(options.gain) && options.gain > 0 ? options.gain : 1;
  const forceDark = options.polarity === "dark";
  const outlineGain = options.darkOutline ? 0.85 : 0;

  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));

  for (let row = 0; row < height; row++) {
    const py = y0 + row;
    if (py < 0 || py >= imgH) continue;
    for (let col = 0; col < width; col++) {
      const px = x0 + col;
      if (px < 0 || px >= imgW) continue;

      const raw = map[row * width + col] ?? 0;
      const mag = Math.abs(raw);
      if (mag * gain < ALPHA_THRESHOLD) continue;

      const isDark = forceDark || raw < 0;
      const logoValue = isDark ? 0 : 255;
      const usedGain = raw < 0 ? gain * (0.6 + outlineGain * 0.4) : gain;
      const alpha = Math.min(mag * usedGain, MAX_ALPHA);
      const inv = 1 - alpha;
      if (inv <= 0.01) continue;

      const imgIdx = (py * imgW + px) * 4;
      for (let c = 0; c < 3; c++) {
        const watermarked = data[imgIdx + c] ?? 0;
        const original = (watermarked - alpha * logoValue) / inv;
        data[imgIdx + c] = Math.max(0, Math.min(255, Math.round(original)));
      }
    }
  }
}

/** Second unblend pass at reduced gain to pick up leftover sparkle, then colour-heal ghosts only. */
export function reverseBlendAndHeal(imageData: ImageData, placement: Placement, options: BlendOptions): void {
  reverseBlend(imageData, placement, options);
  reverseBlend(imageData, placement, { ...options, gain: (options.gain || 1) * 0.32 });

  const heal = options.heal ?? 0;
  if (heal <= 0.01) return;

  const map = resolveMap(placement, options);
  const mask = maskFromAlpha(
    imageData.width,
    imageData.height,
    Math.floor(placement.x),
    Math.floor(placement.y),
    map,
    placement.width,
    placement.height,
    0.08,
  );
  // Only fill pixels that still look like a leftover logo vs their neighbourhood.
  const { width: w, height: h, data } = imageData;
  const residual = new Float32Array(mask.length);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const m = mask[i] ?? 0;
      if (m < 0.05) continue;
      const idx = i * 4;
      const lum = ((data[idx] ?? 0) * 2 + (data[idx + 1] ?? 0) * 3 + (data[idx + 2] ?? 0)) / 6;
      let nLum = 0;
      let n = 0;
      const sample = (xx: number, yy: number) => {
        const si = yy * w + xx;
        if ((mask[si] ?? 0) > 0.08) return;
        const sidx = si * 4;
        nLum += ((data[sidx] ?? 0) * 2 + (data[sidx + 1] ?? 0) * 3 + (data[sidx + 2] ?? 0)) / 6;
        n++;
      };
      sample(x - 2, y);
      sample(x + 2, y);
      sample(x, y - 2);
      sample(x, y + 2);
      sample(x - 2, y - 2);
      sample(x + 2, y + 2);
      if (!n) continue;
      nLum /= n;
      const ghost = Math.abs(lum - nLum);
      if (ghost < 10) continue;
      residual[i] = Math.min(1, m * heal * Math.min(1, (ghost - 8) / 28));
    }
  }
  colorPreserveFill(imageData, residual, 28);
}

export function fillOverlayBoxes(imageData: ImageData, boxes: OverlayBox[], strength = 1): void {
  if (!boxes.length || strength <= 0) return;
  const mask = maskFromBoxes(imageData.width, imageData.height, boxes, 3);
  if (strength < 0.99) {
    for (let i = 0; i < mask.length; i++) mask[i] = (mask[i] ?? 0) * strength;
  }
  colorPreserveFill(imageData, mask, 48);
}

export function forwardBlend(
  imageData: ImageData,
  placement: Placement,
  mapKind: MapKind,
  gain = 1,
  logoValue = 255,
  mapId?: string,
): void {
  const { x, y, width, height } = placement;
  const imgW = imageData.width;
  const imgH = imageData.height;
  const data = imageData.data;
  const map = mapId ? (getAlphaMapById(mapId, width, height) ?? getAlphaMap(mapKind, width, height)) : getAlphaMap(mapKind, width, height);

  for (let row = 0; row < height; row++) {
    const py = y + row;
    if (py < 0 || py >= imgH) continue;
    for (let col = 0; col < width; col++) {
      const px = x + col;
      if (px < 0 || px >= imgW) continue;
      const raw = map[row * width + col] ?? 0;
      const mag = Math.abs(raw) * gain;
      if (mag < ALPHA_THRESHOLD) continue;
      const alpha = Math.min(mag, 1);
      const lv = raw < 0 ? 0 : logoValue;
      const imgIdx = (py * imgW + px) * 4;
      for (let c = 0; c < 3; c++) {
        const orig = data[imgIdx + c] ?? 0;
        data[imgIdx + c] = Math.round(alpha * lv + (1 - alpha) * orig);
      }
    }
  }
}

export function cloneImageData(src: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
}

export function trimBlackBars(imageData: ImageData, threshold = 12): ImageData {
  const { width, height, data } = imageData;
  const rowIsBlack = (y: number) => {
    let acc = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      acc += (data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0);
    }
    return acc / (width * 3) < threshold;
  };
  const colIsBlack = (x: number) => {
    let acc = 0;
    for (let y = 0; y < height; y++) {
      const i = (y * width + x) * 4;
      acc += (data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0);
    }
    return acc / (height * 3) < threshold;
  };

  let top = 0;
  let bottom = height - 1;
  let left = 0;
  let right = width - 1;
  while (top < bottom && rowIsBlack(top)) top++;
  while (bottom > top && rowIsBlack(bottom)) bottom--;
  while (left < right && colIsBlack(left)) left++;
  while (right > left && colIsBlack(right)) right--;

  const tw = right - left + 1;
  const th = bottom - top + 1;
  if (tw <= 8 || th <= 8 || (tw === width && th === height)) return imageData;

  const out = new ImageData(tw, th);
  for (let y = 0; y < th; y++) {
    const srcStart = ((top + y) * width + left) * 4;
    const dstStart = y * tw * 4;
    out.data.set(data.subarray(srcStart, srcStart + tw * 4), dstStart);
  }
  return out;
}
