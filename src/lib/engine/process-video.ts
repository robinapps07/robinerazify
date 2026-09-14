import type { DetectParams, MapKind } from "./types";
import { usesFill } from "./types";
import { reverseBlendAndHeal } from "./blend";
import { blurGrokLockup, eraseDolaWordmark } from "./inpaint";
import { fillBoxFromParams, placementFromParams } from "./process-image";

export type VideoProgress = {
  progress: number;
  message: string;
};

export type VideoQualityLevel = "medium" | "high" | "very-high";

type Mediabunny = typeof import("mediabunny");

let enginePromise: Promise<Mediabunny> | null = null;

/** Load the local encoder. Call early on the video tab so download is ready. */
export function preloadVideoEngine(): Promise<Mediabunny> | undefined {
  if (typeof window === "undefined") return undefined;
  if (!enginePromise) {
    enginePromise = import("mediabunny");
  }
  return enginePromise;
}

async function loadVideoEngine(): Promise<Mediabunny> {
  const p = preloadVideoEngine();
  if (!p) throw new Error("Video encode runs in this browser tab.");
  try {
    return await p;
  } catch {
    enginePromise = null;
    throw new Error("Video encoder could not load. Check the connection and tap download again.");
  }
}

export async function processVideoFile(
  file: Blob,
  params: DetectParams,
  mapKind: MapKind,
  polarity: "light" | "dark",
  onProgress?: (p: VideoProgress) => void,
  signal?: AbortSignal,
  qualityLevel: VideoQualityLevel = "high",
): Promise<Blob> {
  onProgress?.({ progress: 0.02, message: "Reading video…" });

  const {
    ALL_FORMATS,
    BlobSource,
    BufferTarget,
    Conversion,
    Input,
    Mp4OutputFormat,
    Output,
    Quality,
  } = await loadVideoEngine();

  const input = new Input({
    source: new BlobSource(file),
    formats: ALL_FORMATS,
  });

  const target = new BufferTarget();
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: "in-memory" }),
    target,
  });

  const canvas = document.createElement("canvas");
  const ctxRef: { ctx: CanvasRenderingContext2D | null } = { ctx: null };
  const methodFill = usesFill(mapKind, params.engine) || params.mapId === "overlay";
  const trackOverlays = methodFill;

  const conversion = await Conversion.init({
    input,
    output,
    video: {
      forceTranscode: true,
      quality: new Quality(qualityLevel),
      process: (sample) => {
        if (signal?.aborted) return null;
        const w = sample.displayWidth;
        const h = sample.displayHeight;
        if (!ctxRef.ctx || canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
          ctxRef.ctx = canvas.getContext("2d", { willReadFrequently: true });
        }
        const ctx = ctxRef.ctx;
        if (!ctx) return canvas;
        sample.draw(ctx, 0, 0, w, h);
        const placement = placementFromParams(params);
        const pad = 8;
        const sx = Math.max(0, placement.x - pad);
        const sy = Math.max(0, placement.y - pad);
        const sw = Math.min(w - sx, placement.width + pad * 2);
        const sh = Math.min(h - sy, placement.height + pad * 2);

        if (sw > 2 && sh > 2 && !methodFill) {
          const region = ctx.getImageData(sx, sy, sw, sh);
          reverseBlendAndHeal(
            region,
            {
              x: placement.x - sx,
              y: placement.y - sy,
              width: placement.width,
              height: placement.height,
            },
            {
              gain: params.gain,
              mapKind,
              mapId: params.mapId,
              darkOutline: params.darkOutline,
              polarity,
              heal: params.heal,
            },
          );
          ctx.putImageData(region, sx, sy);
        }

        if (trackOverlays) {
          const box = fillBoxFromParams(params, w, h);
          const dola = params.engine === "dola" || mapKind === "dola";
          const padBand = dola ? 28 : 6;
          const bandX = Math.max(0, box.x - padBand);
          const bandY = Math.max(0, box.y - padBand);
          const bandW = Math.min(w - bandX, box.width + padBand * 2);
          const bandH = Math.min(h - bandY, box.height + padBand * 2);
          if (bandW > 2 && bandH > 2) {
            const region = ctx.getImageData(bandX, bandY, bandW, bandH);
            const local = {
              x: Math.max(0, box.x - bandX),
              y: Math.max(0, box.y - bandY),
              width: box.width,
              height: box.height,
              score: 1,
            };
            if (dola) eraseDolaWordmark(region, local);
            else blurGrokLockup(region, local);
            ctx.putImageData(region, bandX, bandY);
          }
        }

        return canvas;
      },
    },
  });

  if (!conversion.isValid) {
    const reasons = conversion.discardedTracks.map((t) => t.reason).join(", ");
    throw new Error(reasons ? `Cannot process this video (${reasons}).` : "Cannot process this video.");
  }

  conversion.onProgress = (progress) => {
    onProgress?.({
      progress: 0.05 + progress * 0.9,
      message: `Cleaning frames… ${Math.round(progress * 100)}%`,
    });
  };

  if (signal) {
    const onAbort = () => {
      void conversion.cancel();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  }

  await conversion.execute();
  onProgress?.({ progress: 1, message: "Packaging MP4…" });

  const buffer = target.buffer;
  if (!buffer) throw new Error("Video encode produced an empty file.");
  return new Blob([buffer], { type: "video/mp4" });
}

export async function firstFrameFromVideo(file: Blob): Promise<{ imageData: ImageData; duration: number; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("Could not read this video in this browser."));
    });
    if (video.readyState < 2) {
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
        video.currentTime = 0.05;
      });
    }
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const probeAt = duration > 0.8 ? Math.min(0.45, duration * 0.12) : 0.12;
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      video.onseeked = done;
      try {
        video.currentTime = probeAt;
      } catch {
        done();
      }
      window.setTimeout(done, 900);
    });
    const w = video.videoWidth;
    const h = video.videoHeight;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas is not available.");
    ctx.drawImage(video, 0, 0);
    return {
      imageData: ctx.getImageData(0, 0, w, h),
      duration: Number.isFinite(video.duration) ? video.duration : 0,
      width: w,
      height: h,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
