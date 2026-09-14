export type OverlayBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
};

function lumaAt(data: Uint8ClampedArray, w: number, x: number, y: number) {
  const i = (y * w + x) * 4;
  return ((data[i] ?? 0) * 2 + (data[i + 1] ?? 0) * 3 + (data[i + 2] ?? 0)) / 6;
}

function satAt(data: Uint8ClampedArray, w: number, x: number, y: number) {
  const i = (y * w + x) * 4;
  const r = data[i] ?? 0;
  const g = data[i + 1] ?? 0;
  const b = data[i + 2] ?? 0;
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function boxBlurLuma(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  radius: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Float32Array {
  const bw = x1 - x0;
  const bh = y1 - y0;
  const out = new Float32Array(bw * bh);
  const r = Math.max(1, radius);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      let sum = 0;
      let n = 0;
      const gy = y0 + y;
      const gx = x0 + x;
      for (let dy = -r; dy <= r; dy += 2) {
        const yy = gy + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -r; dx <= r; dx += 2) {
          const xx = gx + dx;
          if (xx < 0 || xx >= w) continue;
          sum += lumaAt(data, w, xx, yy);
          n++;
        }
      }
      out[y * bw + x] = n ? sum / n : lumaAt(data, w, gx, gy);
    }
  }
  return out;
}

/** Skip phone-screenshot letterboxing so the Grok mark is found on the photo, not in the black bars. */
export function contentRect(imageData: ImageData, threshold = 10): { x0: number; y0: number; x1: number; y1: number } {
  const { width: w, height: h, data } = imageData;
  const rowMean = (y: number) => {
    let acc = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      acc += (data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0);
    }
    return acc / (w * 3);
  };
  let y0 = 0;
  let y1 = h;
  while (y0 < h - 8 && rowMean(y0) < threshold) y0++;
  while (y1 > y0 + 8 && rowMean(y1 - 1) < threshold) y1--;
  return { x0: 0, y0, x1: w, y1 };
}

function medianOf(arr: number[]): number {
  if (!arr.length) return 128;
  const s = arr.slice().sort((a, b) => a - b);
  return s[(s.length / 2) | 0] ?? 128;
}

/** Long bright diagonal = track lane line, not the compact Grok lockup. */
function isLaneLinePixel(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number,
): boolean {
  const lum = lumaAt(data, w, x, y);
  if (lum < 170) return false;
  const dirs: Array<[number, number]> = [
    [-1, -1],
    [-2, -1],
    [-1, -2],
    [1, 1],
    [2, 1],
  ];
  for (const [dx, dy] of dirs) {
    let run = 1;
    for (const sign of [1, -1] as const) {
      for (let s = 1; s < 36; s++) {
        const xx = x + dx * s * sign;
        const yy = y + dy * s * sign;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) break;
        if (lumaAt(data, w, xx, yy) < 162) break;
        run++;
      }
    }
    if (run >= 20) return true;
  }
  return false;
}

/** Jacobi / Laplace fill: logo pixels take the surrounding background colour. */
export function colorPreserveFill(imageData: ImageData, mask: Float32Array, passes = 40): void {
  const { width: w, height: h, data } = imageData;
  const n = w * h;
  if (mask.length < n) return;

  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if ((mask[y * w + x] ?? 0) > 0.02) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < x0) return;

  x0 = Math.max(0, x0 - 3);
  y0 = Math.max(0, y0 - 3);
  x1 = Math.min(w - 1, x1 + 3);
  y1 = Math.min(h - 1, y1 + 3);
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const a = new Float32Array(bw * bh * 3);
  const b = new Float32Array(bw * bh * 3);
  const m = new Float32Array(bw * bh);

  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const gi = ((y0 + y) * w + (x0 + x)) * 4;
      const li = y * bw + x;
      m[li] = Math.min(1, mask[(y0 + y) * w + (x0 + x)] ?? 0);
      a[li * 3] = data[gi] ?? 0;
      a[li * 3 + 1] = data[gi + 1] ?? 0;
      a[li * 3 + 2] = data[gi + 2] ?? 0;
    }
  }
  b.set(a);

  const knownR: number[] = [];
  const knownG: number[] = [];
  const knownB: number[] = [];
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const li = y * bw + x;
      if ((m[li] ?? 0) > 0.15) continue;
      knownR.push(a[li * 3] ?? 0);
      knownG.push(a[li * 3 + 1] ?? 0);
      knownB.push(a[li * 3 + 2] ?? 0);
    }
  }
  const seedR = medianOf(knownR);
  const seedG = medianOf(knownG);
  const seedB = medianOf(knownB);
  if (knownR.length) {
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const li = y * bw + x;
        const mv = m[li] ?? 0;
        if (mv < 0.15) continue;
        a[li * 3] = seedR;
        a[li * 3 + 1] = seedG;
        a[li * 3 + 2] = seedB;
        b[li * 3] = seedR;
        b[li * 3 + 1] = seedG;
        b[li * 3 + 2] = seedB;
      }
    }
  }

  let src = a;
  let dst = b;
  const iter = Math.max(20, Math.min(72, passes));
  for (let p = 0; p < iter; p++) {
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const li = y * bw + x;
        const mv = m[li] ?? 0;
        if (mv < 0.02) {
          dst[li * 3] = src[li * 3] ?? 0;
          dst[li * 3 + 1] = src[li * 3 + 1] ?? 0;
          dst[li * 3 + 2] = src[li * 3 + 2] ?? 0;
          continue;
        }
        let r = 0;
        let g = 0;
        let bl = 0;
        let c = 0;
        const add = (xx: number, yy: number, wt = 1) => {
          if (xx < 0 || yy < 0 || xx >= bw || yy >= bh) return;
          const ni = yy * bw + xx;
          r += (src[ni * 3] ?? 0) * wt;
          g += (src[ni * 3 + 1] ?? 0) * wt;
          bl += (src[ni * 3 + 2] ?? 0) * wt;
          c += wt;
        };
        add(x - 1, y);
        add(x + 1, y);
        add(x, y - 1);
        add(x, y + 1);
        add(x - 1, y - 1, 0.45);
        add(x + 1, y - 1, 0.45);
        add(x - 1, y + 1, 0.45);
        add(x + 1, y + 1, 0.45);
        if (!c) continue;
        dst[li * 3] = r / c;
        dst[li * 3 + 1] = g / c;
        dst[li * 3 + 2] = bl / c;
      }
    }
    const tmp = src;
    src = dst;
    dst = tmp;
  }

  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const li = y * bw + x;
      const mv = m[li] ?? 0;
      if (mv < 0.01) continue;
      const gi = ((y0 + y) * w + (x0 + x)) * 4;
      for (let c = 0; c < 3; c++) {
        const orig = data[gi + c] ?? 0;
        const filled = src[li * 3 + c] ?? orig;
        data[gi + c] = Math.max(0, Math.min(255, Math.round(orig * (1 - mv) + filled * mv)));
      }
    }
  }
}

export function maskFromAlpha(
  imgW: number,
  imgH: number,
  x: number,
  y: number,
  map: Float32Array,
  mw: number,
  mh: number,
  threshold = 0.05,
): Float32Array {
  const mask = new Float32Array(imgW * imgH);
  for (let row = 0; row < mh; row++) {
    const py = y + row;
    if (py < 0 || py >= imgH) continue;
    for (let col = 0; col < mw; col++) {
      const px = x + col;
      if (px < 0 || px >= imgW) continue;
      const a = Math.abs(map[row * mw + col] ?? 0);
      if (a > threshold) mask[py * imgW + px] = Math.min(1, a);
    }
  }
  return mask;
}

export function maskFromBoxes(imgW: number, imgH: number, boxes: OverlayBox[], pad = 2): Float32Array {
  const mask = new Float32Array(imgW * imgH);
  for (const box of boxes) {
    const x0 = Math.max(0, box.x - pad);
    const y0 = Math.max(0, box.y - pad);
    const x1 = Math.min(imgW, box.x + box.width + pad);
    const y1 = Math.min(imgH, box.y + box.height + pad);
    const feather = 3;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const dx = Math.min(x - x0, x1 - 1 - x);
        const dy = Math.min(y - y0, y1 - 1 - y);
        const edge = Math.min(dx, dy);
        const a = edge >= feather ? 1 : Math.max(0.35, edge / feather);
        const i = y * imgW + x;
        mask[i] = Math.max(mask[i] ?? 0, a);
      }
    }
  }
  return mask;
}

function dilateMaskRegion(
  mask: Float32Array,
  w: number,
  h: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
): void {
  if (radius < 1) return;
  const bw = x1 - x0;
  const bh = y1 - y0;
  const src = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) src[y * bw + x] = mask[(y0 + y) * w + (x0 + x)] ?? 0;
  }
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      let m = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
          if (dx * dx + dy * dy > radius * radius + 1) continue;
          m = Math.max(m, src[ny * bw + nx] ?? 0);
        }
      }
      mask[(y0 + y) * w + (x0 + x)] = m;
    }
  }
}

export function findOverlayBoxes(imageData: ImageData, opts?: { fromYRatio?: number; fromXRatio?: number }): OverlayBox[] {
  const { width: w, height: h, data } = imageData;
  if (w < 32 || h < 32) return [];

  const y0 = Math.max(0, Math.floor(h * (opts?.fromYRatio ?? 0.72)));
  const x0 = Math.max(0, Math.floor(w * (opts?.fromXRatio ?? 0)));
  const bw = w - x0;
  const bh = h - y0;
  const blur = boxBlurLuma(data, w, h, 10, x0, y0, w, h);
  const flags = new Uint8Array(bw * bh);

  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const lum = lumaAt(data, w, x0 + x, y0 + y);
      const bg = blur[y * bw + x] ?? lum;
      const excess = lum - bg;
      if ((lum > 148 && excess > 14) || (lum < 90 && bg - lum > 22)) flags[y * bw + x] = 1;
    }
  }

  const seen = new Uint8Array(bw * bh);
  const boxes: OverlayBox[] = [];
  const stack: number[] = [];
  for (let i = 0; i < flags.length; i++) {
    if (!flags[i] || seen[i]) continue;
    stack.push(i);
    seen[i] = 1;
    let minX = bw;
    let minY = bh;
    let maxX = 0;
    let maxY = 0;
    let area = 0;
    let excess = 0;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % bw;
      const y = (p / bw) | 0;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      area++;
      const lum = lumaAt(data, w, x0 + x, y0 + y);
      excess += Math.abs(lum - (blur[y * bw + x] ?? lum));
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
          const ni = ny * bw + nx;
          if (!flags[ni] || seen[ni]) continue;
          seen[ni] = 1;
          stack.push(ni);
        }
      }
    }
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    if (area < 20 || width * height > w * h * 0.04) continue;
    const score = (excess / Math.max(1, area)) * Math.log2(2 + area);
    if (score < 11) continue;
    boxes.push({ x: x0 + minX, y: y0 + minY, width, height, score });
  }
  boxes.sort((a, b) => b.score - a.score);
  return boxes.slice(0, 6);
}

/**
 * Real Grok Imagine marks are a tiny circular icon + "Grok" in the bottom-right
 * of the *photo* (not phone letterbox). Always return a tight BR pocket so we
 * erase — never a large generated lockup that would get painted on.
 */
export function findGrokCornerMark(imageData: ImageData): OverlayBox | null {
  const { width: imgW, height: imgH, data } = imageData;
  if (imgW < 48 || imgH < 48) return null;

  const cr = contentRect(imageData);
  const W = cr.x1 - cr.x0;
  const H = cr.y1 - cr.y0;
  if (W < 48 || H < 48) return null;

  const landscape = W > H * 1.12;
  const tw = landscape
    ? Math.max(72, Math.min(168, Math.round(W * 0.09)))
    : Math.max(48, Math.min(110, Math.round(W * 0.12)));
  const th = landscape
    ? Math.max(14, Math.min(26, Math.round(H * 0.04)))
    : Math.max(14, Math.min(30, Math.round(H * 0.022)));
  const margin = Math.max(4, Math.min(10, Math.round(Math.min(W, H) * 0.008)));
  const fallback: OverlayBox = {
    x: Math.max(cr.x0, cr.x1 - tw - margin),
    y: Math.max(cr.y0, cr.y1 - th - margin),
    width: Math.min(tw, cr.x1 - Math.max(cr.x0, cr.x1 - tw - margin)),
    height: Math.min(th, cr.y1 - Math.max(cr.y0, cr.y1 - th - margin)),
    score: 0.46,
  };

  const px0 = Math.max(cr.x0, cr.x1 - Math.round(W * (landscape ? 0.14 : 0.18)));
  const py0 = Math.max(cr.y0, cr.y1 - Math.round(H * (landscape ? 0.08 : 0.045)));
  const lumas: number[] = [];
  for (let y = py0; y < cr.y1; y++) {
    for (let x = px0; x < cr.x1; x++) lumas.push(lumaAt(data, imgW, x, y));
  }
  lumas.sort((a, b) => a - b);
  const bgLum = lumas[(lumas.length * 0.3) | 0] ?? 110;

  let minX = cr.x1;
  let minY = cr.y1;
  let maxX = cr.x0;
  let maxY = cr.y0;
  let n = 0;
  for (let y = py0; y < cr.y1; y++) {
    for (let x = px0; x < cr.x1; x++) {
      const lum = lumaAt(data, imgW, x, y);
      if (lum < bgLum + 12 || lum < 122) continue;
      if (isLaneLinePixel(data, imgW, imgH, x, y)) continue;
      const s = satAt(data, imgW, x, y);
      if (s > 95 && lum < bgLum + 28) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      n++;
    }
  }

  if (n >= 16) {
    const padX = 2;
    const padTop = 1;
    const padBot = 1;
    let bx = Math.max(cr.x0, minX - padX);
    let by = Math.max(cr.y0, minY - padTop);
    let bw = Math.min(cr.x1 - bx, maxX - minX + 1 + padX + 1);
    let bh = Math.min(cr.y1 - by, maxY - minY + 1 + padTop + padBot);
    const maxW = Math.max(36, Math.min(tw, Math.round(W * (landscape ? 0.1 : 0.13))));
    const maxH = Math.max(10, Math.min(th, Math.round(H * (landscape ? 0.048 : 0.026))));
    if (bw > maxW) {
      bx = Math.max(cr.x0, bx + (bw - maxW));
      bw = Math.min(maxW, cr.x1 - bx);
    }
    if (bh > maxH) {
      bh = Math.min(maxH, cr.y1 - by);
    }
    const logoAt = (x: number, y: number) => {
      const lum = lumaAt(data, imgW, x, y);
      return lum >= bgLum + 12 && lum >= 122 && !isLaneLinePixel(data, imgW, imgH, x, y);
    };
    while (bw > 28) {
      let c = 0;
      for (let y = by; y < by + bh; y++) if (logoAt(bx, y)) c++;
      if (c > Math.max(2, bh * 0.08)) break;
      bx++;
      bw--;
    }
    while (bw > 28) {
      let c = 0;
      const xx = bx + bw - 1;
      for (let y = by; y < by + bh; y++) if (logoAt(xx, y)) c++;
      if (c > Math.max(2, bh * 0.08)) break;
      bw--;
    }
    while (bh > 10) {
      let c = 0;
      const yy = by + bh - 1;
      for (let x = bx; x < bx + bw; x++) if (logoAt(x, yy)) c++;
      if (c > Math.max(2, bw * 0.08)) break;
      bh--;
    }
    if (bw >= 24 && bh >= 8 && bx + bw > cr.x1 - W * 0.05 && by + bh > cr.y1 - H * 0.04) {
      return { x: bx, y: by, width: bw, height: bh, score: Math.min(0.9, 0.52 + n / 400) };
    }
  }

  return fallback;
}

/**
 * Dola AI wordmark is always a small "Dola AI" in the bottom-right.
 * Snap to the lowest bright text band so a white road line above the
 * letters cannot pull the box off the glyphs.
 */
export function findDolaCornerMark(imageData: ImageData): OverlayBox | null {
  const { width: imgW, height: imgH, data } = imageData;
  if (imgW < 48 || imgH < 48) return null;

  const cr = contentRect(imageData);
  const W = cr.x1 - cr.x0;
  const H = cr.y1 - cr.y0;
  if (W < 48 || H < 48) return null;

  const tw = Math.max(64, Math.min(200, Math.round(W * 0.12)));
  const th = Math.max(14, Math.min(32, Math.round(H * 0.016)));
  const margin = Math.max(8, Math.min(24, Math.round(Math.min(W, H) * 0.018)));
  const fallback: OverlayBox = {
    x: Math.max(cr.x0, cr.x1 - tw - margin),
    y: Math.max(cr.y0, cr.y1 - th - margin),
    width: Math.min(tw, cr.x1 - Math.max(cr.x0, cr.x1 - tw - margin)),
    height: Math.min(th, cr.y1 - Math.max(cr.y0, cr.y1 - th - margin)),
    score: 0.38,
  };

  const px0 = Math.max(cr.x0, cr.x1 - Math.round(W * 0.38));
  const py0 = Math.max(cr.y0, cr.y1 - Math.round(H * 0.14));

  type Row = { y: number; count: number; minX: number; maxX: number };
  const rows: Row[] = [];
  for (let y = cr.y1 - 1; y >= py0; y--) {
    let count = 0;
    let minX = cr.x1;
    let maxX = cr.x0;
    for (let x = px0; x < cr.x1; x++) {
      const lum = lumaAt(data, imgW, x, y);
      if (lum < 148) continue;
      if (satAt(data, imgW, x, y) > 70) continue;
      if (isLaneLinePixel(data, imgW, imgH, x, y)) continue;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
    if (count >= 6) rows.push({ y, count, minX, maxX });
  }

  type Band = { y0: number; y1: number; minX: number; maxX: number; count: number };
  const bands: Band[] = [];
  for (const r of rows) {
    const last = bands[bands.length - 1];
    if (last && last.y0 - r.y <= 2) {
      last.y0 = r.y;
      last.minX = Math.min(last.minX, r.minX);
      last.maxX = Math.max(last.maxX, r.maxX);
      last.count += r.count;
    } else {
      bands.push({ y0: r.y, y1: r.y, minX: r.minX, maxX: r.maxX, count: r.count });
    }
  }

  let best: OverlayBox | null = null;
  let bestScore = -1;
  for (const b of bands) {
    const width = b.maxX - b.minX + 1;
    const height = b.y1 - b.y0 + 1;
    if (height < 7 || width < 28) continue;
    if (width > W * 0.42 || height > H * 0.08) continue;
    const aspect = width / Math.max(1, height);
    if (aspect < 2.2 || aspect > 10) continue;
    if (b.maxX < cr.x1 - W * 0.28) continue;
    if (b.y1 < cr.y1 - H * 0.12) continue;
    const dist = Math.hypot(cr.x1 - (b.minX + b.maxX) / 2, cr.y1 - (b.y0 + b.y1) / 2) / Math.max(W, H);
    const score = ((aspect >= 3 && aspect <= 7 ? 2.6 : 1.1) * Math.log2(8 + b.count)) / (0.06 + dist);
    if (score > bestScore) {
      bestScore = score;
      const padX = Math.max(4, Math.round(width * 0.06));
      const padY = Math.max(3, Math.round(height * 0.22));
      const bx = Math.max(cr.x0, b.minX - padX);
      const by = Math.max(cr.y0, b.y0 - padY);
      best = {
        x: bx,
        y: by,
        width: Math.min(cr.x1 - bx, width + padX * 2),
        height: Math.min(cr.y1 - by, height + padY * 2),
        score: Math.min(0.94, 0.62 + b.count / 800),
      };
    }
  }

  return best ?? fallback;
}

export function residualMaskInBox(
  imageData: ImageData,
  box: { x: number; y: number; width: number; height: number },
  pad = 10,
): Float32Array {
  const { width: W, height: H, data } = imageData;
  const mask = new Float32Array(W * H);
  const x0 = Math.max(0, Math.floor(box.x) - pad);
  const y0 = Math.max(0, Math.floor(box.y) - pad);
  const x1 = Math.min(W, Math.ceil(box.x + box.width) + pad);
  const y1 = Math.min(H, Math.ceil(box.y + box.height) + pad);
  if (x1 - x0 < 4 || y1 - y0 < 4) return mask;

  const border: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    border.push(lumaAt(data, W, x, y));
  };
  for (let x = x0; x < x1; x++) {
    push(x, y0);
    push(x, y1 - 1);
  }
  for (let y = y0; y < y1; y++) {
    push(x0, y);
    push(x1 - 1, y);
  }
  border.sort((a, b) => a - b);
  const bg = border.length ? (border[(border.length / 2) | 0] ?? 128) : 128;
  const blur = boxBlurLuma(data, W, H, 12, x0, y0, x1, y1);
  const bw = x1 - x0;

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const lum = lumaAt(data, W, x, y);
      const local = blur[(y - y0) * bw + (x - x0)] ?? lum;
      const light = lum - local;
      const vsBorder = lum - bg;
      let a = 0;
      if (light > 12 && lum > 142) a = Math.min(1, (light - 8) / 20);
      if (vsBorder > 22 && lum > 150) a = Math.max(a, Math.min(1, (vsBorder - 14) / 24));
      if (lum > 200 && vsBorder > 16) a = Math.max(a, 0.96);
      if (lum > 175 && (vsBorder > 12 || light > 8)) a = Math.max(a, 0.9);
      if (a > 0.08) mask[y * W + x] = a;
    }
  }
  dilateMaskRegion(mask, W, H, x0, y0, x1, y1, 3);
  return mask;
}

function boxAreaSum(mask: Float32Array, w: number, box: { x: number; y: number; width: number; height: number }): number {
  let sum = 0;
  const x0 = Math.max(0, box.x);
  const y0 = Math.max(0, box.y);
  const x1 = Math.min(w, box.x + box.width);
  const y1 = Math.min(mask.length / w, box.y + box.height);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) sum += mask[y * w + x] ?? 0;
  }
  return sum;
}

export function textureHeal(imageData: ImageData, mask: Float32Array): void {
  const { width: W, height: H, data } = imageData;
  const n = W * H;
  if (mask.length < n) return;

  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if ((mask[y * W + x] ?? 0) > 0.08) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < x0) return;

  const reach = 28;
  x0 = Math.max(0, x0 - reach);
  y0 = Math.max(0, y0 - reach);
  x1 = Math.min(W - 1, x1 + reach);
  y1 = Math.min(H - 1, y1 + reach);
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;

  const known = new Uint8Array(bw * bh);
  const origR = new Uint8Array(bw * bh);
  const origG = new Uint8Array(bw * bh);
  const origB = new Uint8Array(bw * bh);
  const holes: number[] = [];

  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const gi = ((y0 + y) * W + (x0 + x)) * 4;
      const li = y * bw + x;
      origR[li] = data[gi] ?? 0;
      origG[li] = data[gi + 1] ?? 0;
      origB[li] = data[gi + 2] ?? 0;
      const mv = mask[(y0 + y) * W + (x0 + x)] ?? 0;
      if (mv < 0.1) known[li] = 1;
      else holes.push(li);
    }
  }
  if (!holes.length) return;

  const lumOf = (li: number) => ((origR[li] ?? 0) * 2 + (origG[li] ?? 0) * 3 + (origB[li] ?? 0)) / 6;

  const medianKnown = (cx: number, cy: number, rad: number) => {
    const rs: number[] = [];
    const gs: number[] = [];
    const bs: number[] = [];
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        const xx = cx + dx;
        const yy = cy + dy;
        if (xx < 0 || yy < 0 || xx >= bw || yy >= bh) continue;
        const li = yy * bw + xx;
        if (!known[li]) continue;
        rs.push(origR[li] ?? 0);
        gs.push(origG[li] ?? 0);
        bs.push(origB[li] ?? 0);
      }
    }
    if (!rs.length) return null;
    const mid = (arr: number[]) => {
      const s = arr.slice().sort((a, b) => a - b);
      return s[(s.length / 2) | 0] ?? 0;
    };
    return { r: mid(rs), g: mid(gs), b: mid(bs) };
  };

  const nearestKnown = (sx: number, sy: number) => {
    for (let r = 1; r <= 36; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const xx = sx + dx;
          const yy = sy + dy;
          if (xx < 0 || yy < 0 || xx >= bw || yy >= bh) continue;
          const li = yy * bw + xx;
          if (known[li]) return { x: xx, y: yy, li };
        }
      }
    }
    return null;
  };

  const trySrc = (xx: number, yy: number) => {
    if (xx < 0 || yy < 0 || xx >= bw || yy >= bh) return -1;
    const li = yy * bw + xx;
    return known[li] ? li : -1;
  };

  const outR = new Uint8Array(origR);
  const outG = new Uint8Array(origG);
  const outB = new Uint8Array(origB);

  for (const li of holes) {
    const sx = li % bw;
    const sy = (li / bw) | 0;
    const med = medianKnown(sx, sy, 10);
    const nk = nearestKnown(sx, sy);
    const cands: number[] = [];
    if (nk) {
      const mir = trySrc(nk.x * 2 - sx, nk.y * 2 - sy);
      if (mir >= 0) cands.push(mir);
      cands.push(nk.li);
    }
    for (const d of [8, 14, 22]) {
      const a = trySrc(sx - d, sy);
      if (a >= 0) cands.push(a);
      const b = trySrc(sx, sy - d);
      if (b >= 0) cands.push(b);
    }

    let best = -1;
    let bestScore = 1e15;
    const targetL = med ? (med.r * 2 + med.g * 3 + med.b) / 6 : 128;
    for (const src of cands) {
      const L = lumOf(src);
      if (med && L > targetL + 18) continue;
      const dr = (origR[src] ?? 0) - (med?.r ?? L);
      const dg = (origG[src] ?? 0) - (med?.g ?? L);
      const db = (origB[src] ?? 0) - (med?.b ?? L);
      const score = dr * dr + dg * dg + db * db;
      if (score < bestScore) {
        bestScore = score;
        best = src;
      }
    }
    if (best < 0) {
      if (nk) best = nk.li;
      else continue;
    }
    outR[li] = origR[best] ?? 0;
    outG[li] = origG[best] ?? 0;
    outB[li] = origB[best] ?? 0;
  }

  for (const li of holes) {
    const sx = li % bw;
    const sy = (li / bw) | 0;
    const gi = ((y0 + sy) * W + (x0 + sx)) * 4;
    const mv = mask[(y0 + sy) * W + (x0 + sx)] ?? 0;
    const a = mv < 0.04 ? 0 : Math.min(1, (mv - 0.03) / 0.08);
    if (a <= 0) continue;
    data[gi] = Math.round((data[gi] ?? 0) * (1 - a) + (outR[li] ?? 0) * a);
    data[gi + 1] = Math.round((data[gi + 1] ?? 0) * (1 - a) + (outG[li] ?? 0) * a);
    data[gi + 2] = Math.round((data[gi + 2] ?? 0) * (1 - a) + (outB[li] ?? 0) * a);
  }
}

function grokOverlayMask(imageData: ImageData, box: OverlayBox): { mask: Float32Array; bgLum: number; medR: number; medG: number; medB: number } {
  const { width: W, height: H, data } = imageData;
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(W, Math.ceil(box.x + box.width));
  const y1 = Math.min(H, Math.ceil(box.y + box.height));
  const mask = new Float32Array(W * H);

  const samplesR: number[] = [];
  const samplesG: number[] = [];
  const samplesB: number[] = [];
  const yA0 = Math.max(0, y0 - 22);
  const xL0 = Math.max(0, x0 - 18);
  const pushIfTrack = (x: number, y: number) => {
    const lum = lumaAt(data, W, x, y);
    if (lum >= 155) return;
    if (satAt(data, W, x, y) < 28) return;
    const i = (y * W + x) * 4;
    samplesR.push(data[i] ?? 0);
    samplesG.push(data[i + 1] ?? 0);
    samplesB.push(data[i + 2] ?? 0);
  };
  for (let y = yA0; y < y0; y++) {
    for (let x = x0; x < x1; x++) pushIfTrack(x, y);
  }
  for (let y = y0; y < y1; y++) {
    for (let x = xL0; x < x0; x++) pushIfTrack(x, y);
  }
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const lum = lumaAt(data, W, x, y);
      if (lum < 132 && satAt(data, W, x, y) > 40) pushIfTrack(x, y);
    }
  }
  const medR = medianOf(samplesR.length ? samplesR : [140]);
  const medG = medianOf(samplesG.length ? samplesG : [90]);
  const medB = medianOf(samplesB.length ? samplesB : [75]);
  const bgLum = (medR * 2 + medG * 3 + medB) / 6;

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const lum = lumaAt(data, W, x, y);
      const d = lum - bgLum;
      if (d <= 8 || lum < 116) continue;
      if (isLaneLinePixel(data, W, H, x, y)) continue;
      const s = satAt(data, W, x, y);
      if (s > 92 && d < 24) continue;
      let a = Math.min(1, (d - 5) / 14);
      if (lum > 150) a = Math.max(a, 0.9);
      if (lum > 175) a = 1;
      mask[y * W + x] = a;
    }
  }
  dilateMaskRegion(mask, W, H, x0, y0, x1, y1, 2);
  return { mask, bgLum, medR, medG, medB };
}

function dolaGlowMask(imageData: ImageData, box: OverlayBox): Float32Array {
  const { width: W, height: H, data } = imageData;
  const mask = new Float32Array(W * H);
  const x0 = Math.max(0, Math.floor(box.x) - 8);
  const y0 = Math.max(0, Math.floor(box.y) - 5);
  const x1 = Math.min(W, Math.ceil(box.x + box.width) + 8);
  const y1 = Math.min(H, Math.ceil(box.y + box.height) + 8);
  if (x1 - x0 < 4 || y1 - y0 < 4) return mask;

  const blur = boxBlurLuma(data, W, H, 8, x0, y0, x1, y1);
  const bw = x1 - x0;
  const ring: number[] = [];
  for (let x = x0; x < x1; x++) {
    ring.push(lumaAt(data, W, x, y0));
    ring.push(lumaAt(data, W, x, y1 - 1));
  }
  for (let y = y0; y < y1; y++) {
    ring.push(lumaAt(data, W, x0, y));
    ring.push(lumaAt(data, W, x1 - 1, y));
  }
  ring.sort((a, b) => a - b);
  const bg = ring[(ring.length / 2) | 0] ?? 128;

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const lum = lumaAt(data, W, x, y);
      const local = blur[(y - y0) * bw + (x - x0)] ?? lum;
      const lift = lum - local;
      const vs = lum - bg;
      let a = 0;
      if (lift > 5) a = Math.min(1, (lift - 2) / 11);
      if (vs > 10) a = Math.max(a, Math.min(1, (vs - 6) / 16));
      if (lum > 168 && (lift > 3 || vs > 6)) a = Math.max(a, 0.92);
      if (lum > 198) a = Math.max(a, 0.98);
      if (a > 0.06) mask[y * W + x] = a;
    }
  }
  dilateMaskRegion(mask, W, H, x0, y0, x1, y1, 3);
  dilateMaskRegion(mask, W, H, x0, y0, x1, y1, 2);
  addSoftOvalHalo(mask, W, H, box);
  featherMask(mask, W, H, x0, y0, x1, y1, 2);
  return mask;
}

function addSoftOvalHalo(mask: Float32Array, W: number, H: number, box: OverlayBox): void {
  const extraX = Math.max(6, Math.round(box.width * 0.08));
  const extraBelow = Math.max(6, Math.round(box.height * 0.22));
  const extraTop = Math.max(3, Math.round(box.height * 0.08));
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2 + extraBelow * 0.12;
  const rx = box.width / 2 + extraX;
  const ry = box.height / 2 + (extraTop + extraBelow) / 2;
  const x0 = Math.max(0, Math.floor(cx - rx));
  const y0 = Math.max(0, Math.floor(cy - ry));
  const x1 = Math.min(W, Math.ceil(cx + rx));
  const y1 = Math.min(H, Math.ceil(cy + ry));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      const d2 = nx * nx + ny * ny;
      if (d2 >= 1) continue;
      const fall = (1 - d2) ** 1.55;
      const a = fall * 0.28;
      const i = y * W + x;
      if (a > (mask[i] ?? 0)) mask[i] = a;
    }
  }
  const stripY0 = Math.max(0, Math.floor(box.y + box.height - 3));
  const stripY1 = Math.min(H, Math.ceil(box.y + box.height + 7));
  const stripX0 = Math.max(0, Math.floor(box.x - extraX));
  const stripX1 = Math.min(W, Math.ceil(box.x + box.width + extraX));
  const span = Math.max(1, stripY1 - stripY0);
  for (let y = stripY0; y < stripY1; y++) {
    const t = (y - stripY0) / span;
    const a = Math.max(0, 1 - t) * 0.28;
    if (a < 0.04) continue;
    for (let x = stripX0; x < stripX1; x++) {
      const i = y * W + x;
      if (a > (mask[i] ?? 0)) mask[i] = a;
    }
  }
}

function featherMask(
  mask: Float32Array,
  W: number,
  H: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
): void {
  const r = Math.max(1, radius);
  const bw = x1 - x0;
  const bh = y1 - y0;
  if (bw < 3 || bh < 3) return;
  const src = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) src[y * bw + x] = mask[(y0 + y) * W + (x0 + x)] ?? 0;
  }
  const tmp = new Float32Array(bw * bh);
  const span = r * 2 + 1;
  for (let y = 0; y < bh; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[y * bw + Math.max(0, Math.min(bw - 1, x))] ?? 0;
    for (let x = 0; x < bw; x++) {
      tmp[y * bw + x] = acc / span;
      acc -= src[y * bw + Math.max(0, x - r)] ?? 0;
      acc += src[y * bw + Math.min(bw - 1, x + r + 1)] ?? 0;
    }
  }
  for (let x = 0; x < bw; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.max(0, Math.min(bh - 1, y)) * bw + x] ?? 0;
    for (let y = 0; y < bh; y++) {
      mask[(y0 + y) * W + (x0 + x)] = acc / span;
      acc -= tmp[Math.max(0, y - r) * bw + x] ?? 0;
      acc += tmp[Math.min(bh - 1, y + r + 1) * bw + x] ?? 0;
    }
  }
}

function hazeSeam(imageData: ImageData, mask: Float32Array, box: OverlayBox): void {
  const { width: W, height: H, data } = imageData;
  const x0 = Math.max(1, Math.floor(box.x) - 12);
  const y0 = Math.max(1, Math.floor(box.y) - 6);
  const x1 = Math.min(W - 1, Math.ceil(box.x + box.width) + 14);
  const y1 = Math.min(H - 1, Math.ceil(box.y + box.height) + 16);
  const copy = new Uint8ClampedArray(data);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const a = mask[y * W + x] ?? 0;
      if (a < 0.05 || a > 0.62) continue;
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const i = (yy * W + xx) * 4;
          r += copy[i] ?? 0;
          g += copy[i + 1] ?? 0;
          b += copy[i + 2] ?? 0;
          n++;
        }
      }
      if (!n) continue;
      const t = 0.22 + a * 0.35;
      const gi = (y * W + x) * 4;
      data[gi] = Math.round((data[gi] ?? 0) * (1 - t) + (r / n) * t);
      data[gi + 1] = Math.round((data[gi + 1] ?? 0) * (1 - t) + (g / n) * t);
      data[gi + 2] = Math.round((data[gi + 2] ?? 0) * (1 - t) + (b / n) * t);
    }
  }
}

function blurBottomAndEdges(imageData: ImageData, box: OverlayBox): void {
  const { width: W, height: H, data } = imageData;
  const x0 = Math.max(1, Math.floor(box.x) - 4);
  const x1 = Math.min(W - 1, Math.ceil(box.x + box.width) + 4);
  const yLine = Math.min(H - 1, Math.ceil(box.y + box.height));
  const y0 = Math.max(1, yLine - 4);
  const y1 = Math.min(H - 1, yLine + 6);
  if (x1 - x0 < 4 || y1 - y0 < 3) return;
  const copy = new Uint8ClampedArray(data);

  const mixAt = (x: number, y: number, rx: number, ry: number, t: number) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let dy = -ry; dy <= ry; dy++) {
      for (let dx = -rx; dx <= rx; dx++) {
        const xx = Math.max(0, Math.min(W - 1, x + dx));
        const yy = Math.max(0, Math.min(H - 1, y + dy));
        const i = (yy * W + xx) * 4;
        r += copy[i] ?? 0;
        g += copy[i + 1] ?? 0;
        b += copy[i + 2] ?? 0;
        n++;
      }
    }
    if (!n || t <= 0) return;
    const gi = (y * W + x) * 4;
    data[gi] = Math.round((data[gi] ?? 0) * (1 - t) + (r / n) * t);
    data[gi + 1] = Math.round((data[gi + 1] ?? 0) * (1 - t) + (g / n) * t);
    data[gi + 2] = Math.round((data[gi + 2] ?? 0) * (1 - t) + (b / n) * t);
  };

  const span = Math.max(1, y1 - y0);
  for (let y = y0; y < y1; y++) {
    const fall = 1 - (y - y0) / span;
    const t = 0.18 + fall * 0.22;
    for (let x = x0; x < x1; x++) mixAt(x, y, 3, 2, t);
  }
}

function inpaintFromNeighbors(imageData: ImageData, mask: Float32Array): void {
  const { width: W, height: H, data } = imageData;
  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if ((mask[y * W + x] ?? 0) > 0.06) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < x0) return;
  x0 = Math.max(0, x0 - 10);
  y0 = Math.max(0, y0 - 10);
  x1 = Math.min(W - 1, x1 + 10);
  y1 = Math.min(H - 1, y1 + 10);
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const wr = new Float32Array(bw * bh);
  const wg = new Float32Array(bw * bh);
  const wb = new Float32Array(bw * bh);
  const known = new Uint8Array(bw * bh);

  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const gi = ((y0 + y) * W + (x0 + x)) * 4;
      const li = y * bw + x;
      wr[li] = data[gi] ?? 0;
      wg[li] = data[gi + 1] ?? 0;
      wb[li] = data[gi + 2] ?? 0;
      if ((mask[(y0 + y) * W + (x0 + x)] ?? 0) < 0.08) known[li] = 1;
    }
  }

  const sample = (sx: number, sy: number, dx: number, dy: number) => {
    let x = sx;
    let y = sy;
    for (let k = 1; k < 48; k++) {
      x += dx;
      y += dy;
      if (x < 0 || y < 0 || x >= bw || y >= bh) return null;
      const li = y * bw + x;
      if (known[li]) return { li, dist: k };
    }
    return null;
  };

  for (let pass = 0; pass < 3; pass++) {
    const nr = new Float32Array(wr);
    const ng = new Float32Array(wg);
    const nb = new Float32Array(wb);
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const li = y * bw + x;
        if (known[li]) continue;
        const hits = [
          sample(x, y, -1, 0),
          sample(x, y, 1, 0),
          sample(x, y, 0, -1),
          sample(x, y, 0, 1),
          sample(x, y, -1, -1),
          sample(x, y, 1, -1),
          sample(x, y, -1, 1),
          sample(x, y, 1, 1),
        ];
        let r = 0;
        let g = 0;
        let b = 0;
        let wsum = 0;
        for (const h of hits) {
          if (!h) continue;
          const wt = 1 / (h.dist * h.dist);
          r += (wr[h.li] ?? 0) * wt;
          g += (wg[h.li] ?? 0) * wt;
          b += (wb[h.li] ?? 0) * wt;
          wsum += wt;
        }
        if (wsum < 1e-6) continue;
        nr[li] = r / wsum;
        ng[li] = g / wsum;
        nb[li] = b / wsum;
      }
    }
    wr.set(nr);
    wg.set(ng);
    wb.set(nb);
  }

  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const li = y * bw + x;
      if (known[li]) continue;
      const gx = x0 + x;
      const gy = y0 + y;
      const mv = mask[gy * W + gx] ?? 0;
      const a = Math.min(1, mv * (mv > 0.55 ? 1.08 : 0.7));
      if (a <= 0.04) continue;
      const gi = (gy * W + gx) * 4;
      data[gi] = Math.round((data[gi] ?? 0) * (1 - a) + (wr[li] ?? 0) * a);
      data[gi + 1] = Math.round((data[gi + 1] ?? 0) * (1 - a) + (wg[li] ?? 0) * a);
      data[gi + 2] = Math.round((data[gi + 2] ?? 0) * (1 - a) + (wb[li] ?? 0) * a);
    }
  }
}

function gradeToRing(imageData: ImageData, mask: Float32Array, box: OverlayBox): void {
  const { width: W, height: H, data } = imageData;
  const x0 = Math.max(0, Math.floor(box.x) - 2);
  const y0 = Math.max(0, Math.floor(box.y) - 2);
  const x1 = Math.min(W, Math.ceil(box.x + box.width) + 2);
  const y1 = Math.min(H, Math.ceil(box.y + box.height) + 2);
  const rx0 = Math.max(0, x0 - 14);
  const ry0 = Math.max(0, y0 - 14);
  const rx1 = Math.min(W, x1 + 14);
  const ry1 = Math.min(H, y1 + 14);

  const sampleAt = (x: number, y: number) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < rx0 || yy < ry0 || xx >= rx1 || yy >= ry1) continue;
        if ((mask[yy * W + xx] ?? 0) > 0.08) continue;
        const i = (yy * W + xx) * 4;
        r += data[i] ?? 0;
        g += data[i + 1] ?? 0;
        b += data[i + 2] ?? 0;
        n++;
      }
    }
    if (n < 3) return null;
    return { r: r / n, g: g / n, b: b / n };
  };

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const a = mask[y * W + x] ?? 0;
      if (a < 0.05) continue;
      const left = sampleAt(x0 - 3, y);
      const right = sampleAt(x1 + 2, y);
      const up = sampleAt(x, y0 - 3);
      const down = sampleAt(x, y1 + 2);
      const tx = x1 === x0 ? 0.5 : (x - x0) / Math.max(1, x1 - x0);
      const ty = y1 === y0 ? 0.5 : (y - y0) / Math.max(1, y1 - y0);
      let tr = 0;
      let tg = 0;
      let tb = 0;
      let tw = 0;
      const add = (s: { r: number; g: number; b: number } | null, w: number) => {
        if (!s || w <= 0) return;
        tr += s.r * w;
        tg += s.g * w;
        tb += s.b * w;
        tw += w;
      };
      add(left, 1 - tx);
      add(right, tx);
      add(up, 1 - ty);
      add(down, ty);
      if (tw < 1e-4) continue;
      tr /= tw;
      tg /= tw;
      tb /= tw;
      const i = (y * W + x) * 4;
      const cr = data[i] ?? 0;
      const cg = data[i + 1] ?? 0;
      const cb = data[i + 2] ?? 0;
      const mix = Math.min(1, a * 0.92);
      let nr = cr * (1 - mix) + tr * mix;
      let ng = cg * (1 - mix) + tg * mix;
      let nb = cb * (1 - mix) + tb * mix;
      const lum = (nr * 2 + ng * 3 + nb) / 6;
      const tLum = (tr * 2 + tg * 3 + tb) / 6;
      if (lum > tLum + 3) {
        const k = tLum / Math.max(1, lum);
        nr *= k;
        ng *= k;
        nb *= k;
      }
      data[i] = Math.max(0, Math.min(255, Math.round(nr)));
      data[i + 1] = Math.max(0, Math.min(255, Math.round(ng)));
      data[i + 2] = Math.max(0, Math.min(255, Math.round(nb)));
    }
  }
}

/** Dola AI wordmark: keep the detected box, paint in surrounding colour so no wet halo. */
export function eraseDolaWordmark(imageData: ImageData, box: OverlayBox): void {
  const { width: W, height: H } = imageData;
  const padded: OverlayBox = {
    x: Math.max(0, Math.floor(box.x) - 5),
    y: Math.max(0, Math.floor(box.y) - 3),
    width: box.width + 10,
    height: box.height + 10,
    score: box.score,
  };
  padded.width = Math.min(W - padded.x, padded.width);
  padded.height = Math.min(H - padded.y, padded.height);
  if (padded.width < 6 || padded.height < 4) return;
  const mask = dolaGlowMask(imageData, padded);
  textureHeal(imageData, mask);
  inpaintFromNeighbors(imageData, mask);
  gradeToRing(imageData, mask, padded);
  hazeSeam(imageData, mask, padded);
  blurBottomAndEdges(imageData, padded);
}

/**
 * Colour-drill the tiny Grok icon + name: copy nearby real background into
 * overlay pixels only. Never reverse-blends a generated logo (that paints a
 * giant fake Grok). Lane lines in the same corner are left alone.
 */
export function eraseGrokLockup(imageData: ImageData, box: OverlayBox): void {
  const { width: W, height: H, data } = imageData;
  const padded: OverlayBox = {
    x: Math.max(0, Math.floor(box.x) - 2),
    y: Math.max(0, Math.floor(box.y) - 2),
    width: box.width + 4,
    height: box.height + 4,
    score: box.score,
  };
  padded.width = Math.min(W - padded.x, padded.width);
  padded.height = Math.min(H - padded.y, padded.height);
  if (padded.width < 6 || padded.height < 6) return;

  const pass = () => {
    const { mask, bgLum, medR, medG, medB } = grokOverlayMask(imageData, padded);
    let any = 0;
    for (let i = 0; i < mask.length; i++) if ((mask[i] ?? 0) > 0.12) any++;
    if (any < 4) return;
    textureHeal(imageData, mask);

    const x0 = padded.x;
    const y0 = padded.y;
    const x1 = Math.min(W, x0 + padded.width);
    const y1 = Math.min(H, y0 + padded.height);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const lum = lumaAt(data, W, x, y);
        if (lum < bgLum + 12 || lum < 122) continue;
        if (isLaneLinePixel(data, W, H, x, y)) continue;
        const a = Math.min(1, (lum - bgLum - 4) / 16);
        const gi = (y * W + x) * 4;
        data[gi] = Math.round((data[gi] ?? 0) * (1 - a) + medR * a);
        data[gi + 1] = Math.round((data[gi + 1] ?? 0) * (1 - a) + medG * a);
        data[gi + 2] = Math.round((data[gi + 2] ?? 0) * (1 - a) + medB * a);
      }
    }
  };

  pass();
  pass();
}

/** Hide the Grok name with scene colour, then a very light outward fade — no hard rectangle. */
export function blurGrokLockup(imageData: ImageData, box: OverlayBox): void {
  const { width: W, height: H, data } = imageData;
  const x0 = Math.max(1, Math.floor(box.x) - 1);
  const y0 = Math.max(1, Math.floor(box.y));
  const x1 = Math.min(W - 1, Math.ceil(box.x + box.width) + 1);
  const y1 = Math.min(H - 1, Math.ceil(box.y + box.height) + 1);
  if (x1 - x0 < 4 || y1 - y0 < 4) return;

  const med3 = (a: number[]) => {
    if (!a.length) return 128;
    const s = a.slice().sort((p, q) => p - q);
    return s[(s.length / 2) | 0] ?? 128;
  };

  const bw = x1 - x0;
  const bh = y1 - y0;
  const rowsR = new Float32Array(bh);
  const rowsG = new Float32Array(bh);
  const rowsB = new Float32Array(bh);
  for (let y = y0; y < y1; y++) {
    const rs: number[] = [];
    const gs: number[] = [];
    const bs: number[] = [];
    const xl = Math.max(0, x0 - 36);
    for (let x = xl; x < x0; x++) {
      const i = (y * W + x) * 4;
      rs.push(data[i] ?? 0);
      gs.push(data[i + 1] ?? 0);
      bs.push(data[i + 2] ?? 0);
    }
    if (rs.length < 6) {
      for (let yy = Math.max(0, y0 - 10); yy < y0; yy++) {
        for (let x = x0; x < x1; x++) {
          const i = (yy * W + x) * 4;
          rs.push(data[i] ?? 0);
          gs.push(data[i + 1] ?? 0);
          bs.push(data[i + 2] ?? 0);
        }
      }
    }
    rowsR[y - y0] = med3(rs);
    rowsG[y - y0] = med3(gs);
    rowsB[y - y0] = med3(bs);
  }
  for (let i = 1; i < bh - 1; i++) {
    rowsR[i] = ((rowsR[i - 1] ?? 0) + (rowsR[i] ?? 0) * 2 + (rowsR[i + 1] ?? 0)) / 4;
    rowsG[i] = ((rowsG[i - 1] ?? 0) + (rowsG[i] ?? 0) * 2 + (rowsG[i + 1] ?? 0)) / 4;
    rowsB[i] = ((rowsB[i - 1] ?? 0) + (rowsB[i] ?? 0) * 2 + (rowsB[i + 1] ?? 0)) / 4;
  }

  const glyph = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    const tr = rowsR[y] ?? 128;
    const tg = rowsG[y] ?? 128;
    const tb = rowsB[y] ?? 128;
    const bgLum = (tr * 2 + tg * 3 + tb) / 6;
    for (let x = 0; x < bw; x++) {
      const gi = ((y0 + y) * W + (x0 + x)) * 4;
      const r = data[gi] ?? 0;
      const g = data[gi + 1] ?? 0;
      const b = data[gi + 2] ?? 0;
      const lum = (r * 2 + g * 3 + b) / 6;
      const dist = Math.abs(lum - bgLum) + (Math.abs(r - tr) + Math.abs(g - tg) + Math.abs(b - tb)) / 6;
      if (dist < 10) continue;
      glyph[y * bw + x] = Math.min(1, (dist - 8) / 28);
    }
  }

  const fade = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      let m = glyph[y * bw + x] ?? 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= bw || yy >= bh) continue;
          const g = glyph[yy * bw + xx] ?? 0;
          const fall = 1 - Math.hypot(dx, dy) / 3.2;
          if (fall > 0) m = Math.max(m, g * fall * 0.42);
        }
      }
      fade[y * bw + x] = m;
    }
  }

  for (let y = 0; y < bh; y++) {
    const tr = rowsR[y] ?? 128;
    const tg = rowsG[y] ?? 128;
    const tb = rowsB[y] ?? 128;
    for (let x = 0; x < bw; x++) {
      const g = glyph[y * bw + x] ?? 0;
      const f = fade[y * bw + x] ?? 0;
      const t = Math.min(0.96, g * 0.9 + f * 0.28);
      if (t < 0.04) continue;
      const gi = ((y0 + y) * W + (x0 + x)) * 4;
      data[gi] = Math.round((data[gi] ?? 0) * (1 - t) + tr * t);
      data[gi + 1] = Math.round((data[gi + 1] ?? 0) * (1 - t) + tg * t);
      data[gi + 2] = Math.round((data[gi + 2] ?? 0) * (1 - t) + tb * t);
    }
  }

  const copy = new Uint8ClampedArray(data);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const f = fade[y * bw + x] ?? 0;
      if (f < 0.08 || f > 0.78) continue;
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.max(0, Math.min(W - 1, x0 + x + dx));
          const yy = Math.max(0, Math.min(H - 1, y0 + y + dy));
          const i = (yy * W + xx) * 4;
          r += copy[i] ?? 0;
          g += copy[i + 1] ?? 0;
          b += copy[i + 2] ?? 0;
          n++;
        }
      }
      if (!n) continue;
      const mix = 0.22 * f;
      const gi = ((y0 + y) * W + (x0 + x)) * 4;
      data[gi] = Math.round((data[gi] ?? 0) * (1 - mix) + (r / n) * mix);
      data[gi + 1] = Math.round((data[gi + 1] ?? 0) * (1 - mix) + (g / n) * mix);
      data[gi + 2] = Math.round((data[gi + 2] ?? 0) * (1 - mix) + (b / n) * mix);
    }
  }
}

export function eraseBrightOverlay(imageData: ImageData, box: OverlayBox): void {
  eraseGrokLockup(imageData, box);
}

export function magicVanish(imageData: ImageData, boxes: OverlayBox[], strength = 1, allowBoxFill = false): void {
  if (!boxes.length || strength <= 0) return;
  const { width: W, height: H } = imageData;
  const mask = new Float32Array(W * H);
  let any = false;

  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i]!;
    if (box.width < 2 || box.height < 2) continue;
    const residual = residualMaskInBox(imageData, box, 10);
    const covered = boxAreaSum(residual, W, box);
    const area = Math.max(1, box.width * box.height);
    if (covered > area * 0.004) {
      for (let p = 0; p < mask.length; p++) {
        const v = residual[p] ?? 0;
        if (v > (mask[p] ?? 0)) mask[p] = v;
      }
      any = true;
    } else if (allowBoxFill && i === 0) {
      const fallback = maskFromBoxes(W, H, [box], 1);
      for (let p = 0; p < mask.length; p++) {
        const v = (fallback[p] ?? 0) * 0.7;
        if (v > (mask[p] ?? 0)) mask[p] = v;
      }
      any = true;
    }
  }

  if (!any) return;
  if (strength < 0.99) {
    for (let i = 0; i < mask.length; i++) mask[i] = (mask[i] ?? 0) * strength;
  }
  textureHeal(imageData, mask);
}

export function boxHasGlyph(
  imageData: ImageData,
  box: { x: number; y: number; width: number; height: number },
): boolean {
  const residual = residualMaskInBox(imageData, box, 6);
  const covered = boxAreaSum(residual, imageData.width, box);
  return covered > Math.max(12, box.width * box.height * 0.018);
}

export function boxesOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
  ratio = 0.45,
): boolean {
  const overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const overlapY = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const overlap = overlapX * overlapY;
  const area = Math.min(a.width * a.height, b.width * b.height);
  return area > 0 && overlap > area * ratio;
}
