import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import {
  CheckCircle2,
  Download,
  LoaderCircle,
  Minus,
  Plus,
  ScanSearch,
  SlidersHorizontal,
  Upload,
  X,
  ZoomIn,
} from "lucide-react";
import { toast } from "sonner";
import { MediaToggle } from "@/components/site-header";
import { SparkleMark } from "@/components/sparkle-mark";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { cn, downloadBlob, formatBytes } from "@/lib/utils";
import { AdsterraBelowDownload } from "@/components/adsterra";
import { useI18n } from "@/components/i18n-provider";
import {
  applyRemoval,
  blobFromImageData,
  detectAndParamsForMedia,
  engineById,
  fillBoxFromParams,
  firstFrameFromVideo,
  imageDataFromFile,
  maybeTrim,
  placementFromParams,
  preloadVideoEngine,
  processVideoFile,
  type DetectParams,
  type DetectionHit,
  type EngineId,
} from "@/lib/engine";

type MediaMode = "image" | "video";
type DetectMode = "auto" | "manual";

type Item = {
  id: string;
  name: string;
  media: MediaMode;
  original: ImageData;
  cleaned: ImageData;
  params: DetectParams;
  hit: DetectionHit;
  file?: File;
};

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime", "video/x-quicktime"];
const TARGETS: Array<{ id: EngineId; label: string }> = [
  { id: "gemini", label: "Gemini Veo" },
  { id: "dola", label: "Dola AI" },
  { id: "grok", label: "Grok" },
];
const ZOOM_PX = 112;
const MAX_IMAGES = 10;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_VIDEOS = 1;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_VIDEO_SEC = 60;

function isImageFile(f: File) {
  return IMAGE_TYPES.includes(f.type) || /\.(png|jpe?g|webp)$/i.test(f.name);
}
function isVideoFile(f: File) {
  return VIDEO_TYPES.includes(f.type) || /\.(mp4|webm|mov)$/i.test(f.name);
}

function videoDurationSec(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    const url = URL.createObjectURL(file);
    const done = (sec: number) => {
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
      resolve(sec);
    };
    video.onloadedmetadata = () => done(Number.isFinite(video.duration) ? video.duration : 0);
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read video"));
    };
    video.src = url;
  });
}

function drawImageData(canvas: HTMLCanvasElement, imageData: ImageData) {
  if (canvas.width !== imageData.width) canvas.width = imageData.width;
  if (canvas.height !== imageData.height) canvas.height = imageData.height;
  canvas.getContext("2d")?.putImageData(imageData, 0, 0);
}

type ZoomWin = {
  place: { x: number; y: number; width: number; height: number };
  sx: number;
  sy: number;
  sw: number;
  sh: number;
};

function zoomWindow(params: DetectParams, imgW: number, imgH: number): ZoomWin {
  const place = placementFromParams(params);
  const pad = Math.round(Math.max(place.height * 1.6, place.width * 0.45, 20));
  let side = Math.max(place.width, place.height) + pad * 2;
  side = Math.max(24, Math.min(side, Math.max(imgW, imgH)));
  let sx = Math.round(place.x + place.width / 2 - side / 2);
  let sy = Math.round(place.y + place.height / 2 - side / 2);
  if (sx < 0) sx = 0;
  if (sy < 0) sy = 0;
  if (sx + side > imgW) sx = Math.max(0, imgW - side);
  if (sy + side > imgH) sy = Math.max(0, imgH - side);
  const sw = Math.max(1, Math.min(side, imgW - sx));
  const sh = Math.max(1, Math.min(side, imgH - sy));
  return { place, sx, sy, sw, sh };
}

function drawZoom(
  canvas: HTMLCanvasElement,
  source: ImageData,
  params: DetectParams,
  stroke: string,
  freeze?: ZoomWin | null,
) {
  const win = freeze ?? zoomWindow(params, source.width, source.height);
  const { place } = zoomWindow(params, source.width, source.height);
  const { sx, sy, sw, sh } = win;
  const size = ZOOM_PX;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const tmp = document.createElement("canvas");
  tmp.width = source.width;
  tmp.height = source.height;
  tmp.getContext("2d")?.putImageData(source, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#d7dbe3";
  ctx.fillRect(0, 0, size, size);
  const scale = Math.min(size / sw, size / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  const ox = (size - dw) / 2;
  const oy = (size - dh) / 2;
  ctx.drawImage(tmp, sx, sy, sw, sh, ox, oy, dw, dh);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.strokeRect(
    ox + (place.x - sx) * scale,
    oy + (place.y - sy) * scale,
    place.width * scale,
    place.height * scale,
  );
}

export function Studio() {
  const { t } = useI18n();
  const [mode, setMode] = useState<MediaMode>("image");
  const [engine, setEngine] = useState<EngineId>("gemini");
  const [detectMode, setDetectMode] = useState<DetectMode>("auto");
  const [item, setItem] = useState<Item | null>(null);
  const [batch, setBatch] = useState<Item[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [compare, setCompare] = useState(false);
  const [trimBars, setTrimBars] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    px: number;
    py: number;
    ox: number;
    oy: number;
    fromZoom: boolean;
    scale: number;
  } | null>(null);
  const zoomFreezeRef = useRef<ZoomWin | null>(null);
  const mainRef = useRef<HTMLCanvasElement>(null);
  const origZoomRef = useRef<HTMLCanvasElement>(null);
  const cleanZoomRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const itemRef = useRef<Item | null>(null);
  const batchRef = useRef<Item[]>([]);
  itemRef.current = item;
  batchRef.current = batch;

  const commitItem = useCallback((updated: Item) => {
    itemRef.current = updated;
    setItem(updated);
    setBatch((prev) => {
      const next = prev.some((x) => x.id === updated.id)
        ? prev.map((x) => (x.id === updated.id ? updated : x))
        : [...prev, updated];
      batchRef.current = next;
      return next;
    });
  }, []);

  const clearMedia = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    itemRef.current = null;
    batchRef.current = [];
    zoomFreezeRef.current = null;
    setBatch([]);
    setItem(null);
    setBusy(null);
    setProgress(0);
    setCompare(false);
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  useEffect(() => {
    if (!item || !mainRef.current) return;
    drawImageData(mainRef.current, compare ? item.original : item.cleaned);
    const freeze = zoomFreezeRef.current;
    if (origZoomRef.current) drawZoom(origZoomRef.current, item.original, item.params, "#3b5bdb", freeze);
    if (cleanZoomRef.current) drawZoom(cleanZoomRef.current, item.cleaned, item.params, "#0f9d6e", freeze);
  }, [item, compare]);

  useEffect(() => {
    if (mode === "video" || item?.media === "video") {
      void preloadVideoEngine();
    }
  }, [mode, item?.media]);

  const recompute = useCallback((next: DetectParams, base: Item) => {
    const cleaned = applyRemoval(base.original, next, base.hit.mapKind, base.hit.polarity);
    commitItem({ ...base, params: next, cleaned });
  }, [commitItem]);

  const patchParams = useCallback(
    (partial: Partial<DetectParams> | ((p: DetectParams) => Partial<DetectParams>)) => {
      const base = itemRef.current;
      if (!base) return;
      const nextPartial = typeof partial === "function" ? partial(base.params) : partial;
      recompute({ ...base.params, ...nextPartial }, base);
    },
    [recompute],
  );

  const ingestImage = useCallback(
    async (
      file: File | null,
      imageData: ImageData,
      name: string,
      media: MediaMode,
      source?: File,
      engineOverride?: EngineId,
      minScanMs = 2800,
    ) => {
      const prepared = maybeTrim(imageData, trimBars);
      const useEngine = engineOverride ?? engine;
      const t0 = Date.now();
      setBusy(t("aiScanning"));
      setProgress(10);
      const tick = window.setInterval(() => {
        const span = Math.max(minScanMs, 400);
        setProgress(Math.min(88, 10 + ((Date.now() - t0) / span) * 78));
      }, 50);
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      const { hit, params: detected } = detectAndParamsForMedia(prepared, useEngine, media);
      const cleaned = applyRemoval(prepared, detected, hit.mapKind, hit.polarity);
      const left = minScanMs - (Date.now() - t0);
      if (left > 0) await new Promise((r) => window.setTimeout(r, left));
      window.clearInterval(tick);
      const next: Item = {
        id: crypto.randomUUID(),
        name,
        media,
        original: prepared,
        cleaned,
        params: detected,
        hit,
        file: source ?? file ?? undefined,
      };
      commitItem(next);
      setProgress(100);
      return next;
    },
    [engine, trimBars, commitItem, t],
  );

  const loadFiles = async (files: FileList | File[]) => {
    let list = [...files];
    if (!list.length) return;
    if (mode === "image") {
      const tooBig = list.filter((f) => isImageFile(f) && f.size > MAX_IMAGE_BYTES);
      for (const f of tooBig) toast.error(`${f.name} · ${t("imageTooBig")}`);
      list = list.filter((f) => !(isImageFile(f) && f.size > MAX_IMAGE_BYTES));
      const images = list.filter(isImageFile);
      if (images.length > MAX_IMAGES) {
        toast.error(t("tooManyImages"));
        const keep = new Set(images.slice(0, MAX_IMAGES));
        list = list.filter((f) => !isImageFile(f) || keep.has(f));
      }
      if (!list.some(isImageFile)) return;
    } else {
      if (list.length > MAX_VIDEOS) {
        toast.error(t("tooManyVideos"));
        return;
      }
      const videoFile = list[0]!;
      if (videoFile.size > MAX_VIDEO_BYTES) {
        toast.error(t("videoTooBig"));
        return;
      }
    }
    setBusy(t("readingFile"));
    setProgress(8);
    setBatch([]);
    batchRef.current = [];
    try {
      if (mode === "video") {
        const videoFile = list[0]!;
        const sec = await videoDurationSec(videoFile);
        if (sec > MAX_VIDEO_SEC) {
          toast.error(t("videoTooLong"));
          return;
        }
      }
      let last: Item | null = null;
      for (let i = 0; i < list.length; i++) {
        const file = list[i]!;
        const asImage = isImageFile(file);
        const asVideo = isVideoFile(file);
        if (mode === "image" && !asImage) {
          toast.error(`${file.name} ${t("notImage")}`);
          continue;
        }
        if (mode === "video" && !asVideo) {
          toast.error(`${file.name} ${t("notVideo")}`);
          continue;
        }
        if (mode === "image") {
          setBusy(`${t("readingImage")} ${i + 1}/${list.length}`);
          setProgress(12 + (i / Math.max(1, list.length)) * 40);
          const data = await imageDataFromFile(file);
          last = await ingestImage(file, data, file.name, "image", file, undefined, i === 0 ? 2800 : 180);
        } else {
          setBusy(t("aiScanning"));
          setProgress(10);
          const frame = await firstFrameFromVideo(file);
          last = await ingestImage(file, frame.imageData, file.name, "video", file, undefined, 2800);
        }
      }
      if (last) {
        const conf = Math.round((last.hit.confidence || 0) * 100);
        toast.success(
          detectMode === "auto"
            ? `${t("autoDetected")} ${engineById(last.hit.engine).label} · ${conf}% ${t("match")}`
            : "Loaded — drag the box onto the mark",
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("loadFail"));
    } finally {
      setBusy(null);
      setProgress(0);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    void loadFiles(e.dataTransfer.files);
  };

  const applyEngine = (id: EngineId) => {
    setEngine(id);
    const base = itemRef.current;
    if (!base) return;
    setBusy(t("detecting"));
    setProgress(20);
    window.setTimeout(() => {
      const { hit, params: detected } = detectAndParamsForMedia(base.original, id, base.media);
      const cleaned = applyRemoval(base.original, detected, hit.mapKind, hit.polarity);
      const updated = { ...base, hit, params: detected, cleaned };
      commitItem(updated);
      setBusy(null);
      setProgress(0);
    }, 40);
  };

  const redetect = () => {
    const base = itemRef.current;
    if (!base) return;
    setBusy(t("detecting"));
    setProgress(20);
    window.setTimeout(() => {
      const current = itemRef.current ?? base;
      const { hit, params: detected } = detectAndParamsForMedia(current.original, engine, current.media);
      const cleaned = applyRemoval(current.original, detected, hit.mapKind, hit.polarity);
      const updated = { ...current, hit, params: detected, cleaned };
      commitItem(updated);
      setDetectMode("auto");
      setBusy(null);
      setProgress(0);
      toast.success(`${t("redetected")} ${engineById(hit.engine).label} · ${Math.round((hit.confidence || 0) * 100)}%`);
    }, 40);
  };

  const exportOne = useCallback(
    async (current: Item, onTick?: (p: number, msg: string) => void) => {
      const tag = "-erazify";
      if (current.media === "video" && current.file) {
        abortRef.current?.abort();
        const ac = new AbortController();
        abortRef.current = ac;
        const blob = await processVideoFile(
          current.file,
          current.params,
          current.hit.mapKind,
          current.hit.polarity,
          (p) => onTick?.(Math.max(6, p.progress * 100), p.message.replace(/\s+\d+%$/, "") || t("downloading")),
          ac.signal,
          "very-high",
        );
        downloadBlob(blob, current.name.replace(/\.[^.]+$/, "") + tag + ".mp4");
      } else {
        onTick?.(55, t("downloading"));
        const blob = await blobFromImageData(current.cleaned, "image/png");
        onTick?.(100, t("downloading"));
        downloadBlob(blob, current.name.replace(/\.[^.]+$/, "") + tag + ".png");
      }
    },
    [t],
  );

  const downloadCurrent = useCallback(async () => {
    const current = itemRef.current;
    if (!current) return;
    setBusy(t("downloading"));
    setProgress(6);
    try {
      await exportOne(current, (p, msg) => {
        setProgress(p);
        setBusy(msg);
      });
      toast.success(t("success"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Export failed.";
      if (/Failed to fetch|dynamically imported|could not load/i.test(msg)) {
        toast.error(t("encoderBusy"));
      } else {
        toast.error(msg);
      }
    } finally {
      setBusy(null);
      setProgress(0);
    }
  }, [exportOne, t]);

  const downloadAll = useCallback(async () => {
    const items = batchRef.current;
    if (!items.length) return;
    setBusy(t("downloading"));
    setProgress(4);
    try {
      for (let i = 0; i < items.length; i++) {
        const cur = items[i]!;
        setBusy(`${t("downloading")} ${i + 1} / ${items.length}`);
        setProgress(((i + 0.15) / items.length) * 100);
        await exportOne(cur, (p) => {
          setProgress(((i + p / 100) / items.length) * 100);
        });
        await new Promise((r) => setTimeout(r, 480));
      }
      setProgress(100);
      toast.success(t("success"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Export failed.";
      if (/Failed to fetch|dynamically imported|could not load/i.test(msg)) {
        toast.error(t("encoderBusy"));
      } else {
        toast.error(msg);
      }
    } finally {
      setBusy(null);
      setProgress(0);
    }
  }, [exportOne, t]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const current = itemRef.current;
    if (!current || !mainRef.current) return;
    const canvas = mainRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const ix = (e.clientX - rect.left) * scaleX;
    const iy = (e.clientY - rect.top) * scaleY;
    const place = placementFromParams(current.params);
    const pad = 36;
    const inside =
      ix >= place.x - pad &&
      iy >= place.y - pad &&
      ix <= place.x + place.width + pad &&
      iy <= place.y + place.height + pad;
    if (!inside && detectMode !== "manual") return;
    setDetectMode("manual");
    setDragging(true);
    dragRef.current = {
      px: e.clientX,
      py: e.clientY,
      ox: current.params.offsetX,
      oy: current.params.offsetY,
      fromZoom: false,
      scale: 1,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const current = itemRef.current;
    if (!dragging || !current || !mainRef.current || !dragRef.current || dragRef.current.fromZoom) return;
    const canvas = mainRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const dx = (e.clientX - dragRef.current.px) * scaleX;
    const dy = (e.clientY - dragRef.current.py) * scaleY;
    patchParams({ offsetX: Math.round(dragRef.current.ox + dx), offsetY: Math.round(dragRef.current.oy + dy) });
  };

  const onPointerUp = () => {
    setDragging(false);
    dragRef.current = null;
    zoomFreezeRef.current = null;
    const current = itemRef.current;
    if (current && origZoomRef.current) drawZoom(origZoomRef.current, current.original, current.params, "#3b5bdb");
    if (current && cleanZoomRef.current) drawZoom(cleanZoomRef.current, current.cleaned, current.params, "#0f9d6e");
  };

  const onZoomPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const current = itemRef.current;
    if (!current || !origZoomRef.current) return;
    const win = zoomWindow(current.params, current.original.width, current.original.height);
    zoomFreezeRef.current = win;
    const scale = Math.min(ZOOM_PX / win.sw, ZOOM_PX / win.sh);
    setDetectMode("manual");
    setDragging(true);
    dragRef.current = {
      px: e.clientX,
      py: e.clientY,
      ox: current.params.offsetX,
      oy: current.params.offsetY,
      fromZoom: true,
      scale,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onZoomPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging || !itemRef.current || !origZoomRef.current || !dragRef.current?.fromZoom) return;
    const rect = origZoomRef.current.getBoundingClientRect();
    const scale = dragRef.current.scale || 1;
    const dx = ((e.clientX - dragRef.current.px) / rect.width) * ZOOM_PX / scale;
    const dy = ((e.clientY - dragRef.current.py) / rect.height) * ZOOM_PX / scale;
    patchParams({ offsetX: Math.round(dragRef.current.ox + dx), offsetY: Math.round(dragRef.current.oy + dy) });
  };

  const accept = mode === "image" ? "image/png,image/jpeg,image/webp" : "video/mp4,video/webm,video/quicktime";
  const place = item
    ? item.hit.method === "fill"
      ? fillBoxFromParams(item.params, item.original.width, item.original.height)
      : placementFromParams(item.params)
    : null;
  const boxStyle = useMemo(() => {
    if (!item || !place) return undefined;
    const w = item.original.width;
    const h = item.original.height;
    return {
      left: `${(place.x / w) * 100}%`,
      top: `${(place.y / h) * 100}%`,
      width: `${(place.width / w) * 100}%`,
      height: `${(place.height / h) * 100}%`,
    } as const;
  }, [item, place]);

  const videoLabel = item?.media === "video" || (!item && mode === "video");
  const isDownloadBusy = !!busy && (busy.startsWith(t("downloading")) || /Downloading|Cleaning|Packaging|encoder|डाउनलोड/i.test(busy));
  const isDetectBusy = !!busy && !isDownloadBusy;

  return (
    <section id="studio" className="mx-auto w-full scroll-mt-20 px-4">
      <div className="lg:flex lg:items-start lg:justify-center lg:gap-10 lg:pt-4">
        <aside className="hidden w-[210px] shrink-0 lg:flex lg:flex-col lg:gap-8 lg:pt-8">
          <Polaroid src="/demo-before-gemini.jpg?v=5" label={t("before")} tilt="-6deg" />
          <Polaroid src="/demo-before-dola.jpg" label={t("before")} tilt="4deg" />
        </aside>

      <div className="mx-auto w-full max-w-lg">
      <MediaToggle
        mode={mode}
        onChange={(m) => {
          setMode(m);
          itemRef.current = null;
          batchRef.current = [];
          setBatch([]);
          setItem(null);
        }}
      />

      <p className="mt-5 mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">{t("targetAi")}</p>
      <div className="flex gap-2">
        {TARGETS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => applyEngine(t.id)}
            className={cn(
              "h-11 flex-1 rounded-full border px-2 text-xs font-medium transition-colors duration-150 sm:text-sm",
              engine === t.id
                ? "border-primary bg-primary-soft text-primary"
                : "border-border bg-surface text-muted hover:text-fg",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-4 flex rounded-xl bg-surface-2 p-1">
        <button
          type="button"
          onClick={() => {
            setDetectMode("auto");
            if (itemRef.current) applyEngine(engine);
          }}
          className={cn(
            "flex h-11 flex-1 items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors duration-150",
            detectMode === "auto" ? "bg-surface text-fg shadow-sm" : "text-muted",
          )}
        >
          <ScanSearch className="size-4" />
          {t("autoDetect")}
        </button>
        <button
          type="button"
          onClick={() => setDetectMode("manual")}
          className={cn(
            "flex h-11 flex-1 items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors duration-150",
            detectMode === "manual" ? "bg-surface text-fg shadow-sm" : "text-muted",
          )}
        >
          <SlidersHorizontal className="size-4" />
          {t("manual")}
        </button>
      </div>

      {isDetectBusy ? (
        <div className="mt-5 rounded-2xl bg-surface px-4 py-3 shadow-card">
          <div className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
              <LoaderCircle className="size-4 shrink-0 animate-spin text-primary" />
              <span className="truncate">{busy}</span>
            </span>
            <span className="shrink-0 font-mono text-sm tabular-nums text-primary">{Math.round(progress)}%</span>
          </div>
          <Progress value={Math.max(8, progress)} className="mt-2.5 h-2" />
        </div>
      ) : null}

      {!item ? (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          className="mt-5 rounded-3xl border border-dashed border-border-strong bg-surface p-5 shadow-card"
        >
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex w-full flex-col items-center gap-3 rounded-2xl bg-surface-2/70 px-4 py-12 text-center"
          >
            <span className="flex size-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
              <Upload className="size-6" />
            </span>
            <div>
              <p className="text-base font-semibold">
                {mode === "image" ? t("dropImage") : t("dropVideo")}
              </p>
              <p className="mt-1 text-sm text-muted">
                {mode === "image" ? t("imageTypes") : t("videoTypes")}
              </p>
              <p className="mt-0.5 text-xs text-subtle">
                {mode === "image" ? t("imageLimit") : t("videoLimit")}
              </p>
            </div>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            multiple={mode === "image"}
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void loadFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          <div className="flex justify-center">
            <div
              className="relative inline-block max-w-56 overflow-hidden rounded-xl bg-surface shadow-card"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <canvas
                ref={mainRef}
                data-preview="main"
                className="block h-auto max-h-40 w-auto max-w-full touch-none sm:max-h-48"
              />
              {place ? (
                <div className="pointer-events-none absolute border-2 border-zoom-orig" style={boxStyle} />
              ) : null}
              <button
                type="button"
                aria-label={t("clearFile")}
                title={t("clearFile")}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  clearMedia();
                }}
                className="absolute top-1.5 right-1.5 z-20 flex size-9 items-center justify-center rounded-full bg-surface text-fg shadow-card ring-1 ring-border transition-colors duration-150 hover:bg-danger hover:text-primary-fg"
              >
                <X className="size-4" strokeWidth={2.5} />
              </button>
            </div>
          </div>

          <div className="mx-auto grid max-w-sm grid-cols-2 gap-2">
            <ZoomCard
              title={t("zoomOrig")}
              hint={t("zoomHint")}
              tone="orig"
              canvasRef={origZoomRef}
              icon={<ZoomIn className="size-3.5" />}
              onPointerDown={onZoomPointerDown}
              onPointerMove={onZoomPointerMove}
              onPointerUp={onPointerUp}
            />
            <ZoomCard
              title={t("zoomClean")}
              tone="clean"
              canvasRef={cleanZoomRef}
              icon={<CheckCircle2 className="size-3.5" />}
            />
          </div>

          <div className="rounded-2xl bg-surface px-3 py-1 shadow-card">
            <Stepper
              label={t("strength")}
              value={`${item.params.gain.toFixed(2)}x`}
              onMinus={() =>
                patchParams((p) => ({ gain: Math.max(0.1, Math.round((p.gain - 0.02) * 100) / 100) }))
              }
              onPlus={() =>
                patchParams((p) => ({ gain: Math.min(2, Math.round((p.gain + 0.02) * 100) / 100) }))
              }
            />
            <Stepper
              label={t("sizeScale")}
              value={`${item.params.scale.toFixed(2)}x`}
              onMinus={() =>
                patchParams((p) => ({ scale: Math.max(0.4, Math.round((p.scale - 0.02) * 100) / 100) }))
              }
              onPlus={() =>
                patchParams((p) => ({ scale: Math.min(2.4, Math.round((p.scale + 0.02) * 100) / 100) }))
              }
            />
            <Stepper
              label={t("posX")}
              value={`${item.params.offsetX}px`}
              onMinus={() => patchParams((p) => ({ offsetX: Math.max(-240, p.offsetX - 2) }))}
              onPlus={() => patchParams((p) => ({ offsetX: Math.min(240, p.offsetX + 2) }))}
            />
            <Stepper
              label={t("posY")}
              value={`${item.params.offsetY}px`}
              onMinus={() => patchParams((p) => ({ offsetY: Math.max(-240, p.offsetY - 2) }))}
              onPlus={() => patchParams((p) => ({ offsetY: Math.min(240, p.offsetY + 2) }))}
            />
            <Stepper
              label={t("colourHeal")}
              value={`${Math.round((item.params.heal ?? 0.72) * 100)}%`}
              onMinus={() =>
                patchParams((p) => ({
                  heal: Math.max(0, Math.round(((p.heal ?? 0.72) - 0.05) * 100) / 100),
                }))
              }
              onPlus={() =>
                patchParams((p) => ({
                  heal: Math.min(1, Math.round(((p.heal ?? 0.72) + 0.05) * 100) / 100),
                }))
              }
            />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border py-1.5">
              <label className="flex items-center gap-2 text-sm text-muted">
                <Switch checked={item.params.darkOutline} onCheckedChange={(v) => patchParams({ darkOutline: v })} />
                {t("darkOutline")}
              </label>
              <label className="flex items-center gap-2 text-sm text-muted">
                <Switch checked={trimBars} onCheckedChange={setTrimBars} />
                {t("trimBars")}
              </label>
            </div>
            <p className="pb-0.5 text-xs leading-relaxed text-subtle">
              {item.hit.engine === "dola"
                ? t("hintDola")
                : item.hit.engine === "grok"
                  ? t("hintGrok")
                  : t("hintGemini")}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {item.hit.confidence > 0 ? (
              <Badge>
                {engineById(item.hit.engine).label} · {Math.round(item.hit.confidence * 100)}% · {item.hit.size}px
              </Badge>
            ) : (
              <Badge>{t("defaultCorner")}</Badge>
            )}
            <span className="text-xs text-subtle">
              {item.original.width}×{item.original.height}
              {item.file ? ` · ${formatBytes(item.file.size)}` : ""}
            </span>
          </div>

          <div className="flex flex-col gap-2">
            {batch.length > 1 ? (
              <div className="rounded-2xl bg-surface p-3 shadow-card">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-subtle">
                    {batch.length} {t("batchReady")}
                  </p>
                  <p className="text-xs tabular-nums text-muted">
                    {Math.max(1, batch.findIndex((b) => b.id === item.id) + 1)} / {batch.length}
                  </p>
                </div>
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {batch.map((b, i) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => {
                        itemRef.current = b;
                        setItem(b);
                      }}
                      className={cn(
                        "flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors duration-150",
                        item.id === b.id
                          ? "bg-primary text-primary-fg shadow-sm"
                          : "bg-surface-2 text-muted hover:text-fg",
                      )}
                      aria-label={`${i + 1}`}
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {batch.length > 1 ? (
              <Button
                id="download-all-btn"
                className="download-btn ad-trigger h-14 w-full rounded-xl text-base font-semibold tracking-tight"
                onClick={() => void downloadAll()}
                disabled={!!busy}
              >
                <Download />
                {busy && isDownloadBusy ? t("downloading") : `${t("downloadAll")} ${batch.length}`}
              </Button>
            ) : null}
            <Button
              id="download-btn"
              className={cn(
                "download-btn ad-trigger h-12 w-full whitespace-normal rounded-xl text-sm font-semibold tracking-tight sm:whitespace-nowrap sm:text-base",
                batch.length > 1 ? "h-11 sm:h-12" : "sm:h-14",
              )}
              variant={batch.length > 1 ? "secondary" : "default"}
              onClick={() => void downloadCurrent()}
              disabled={!!busy}
            >
              <Download />
              {busy && isDownloadBusy && batch.length < 2
                ? t("downloading")
                : videoLabel
                  ? t("downloadVideo")
                  : batch.length > 1
                    ? t("downloadThis")
                    : t("downloadImage")}
            </Button>
            {isDownloadBusy ? (
              <div className="rounded-2xl bg-surface px-4 py-3 shadow-card">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                    <LoaderCircle className="size-4 shrink-0 animate-spin text-primary" />
                    <span className="truncate">{busy}</span>
                  </span>
                  <span className="shrink-0 font-mono text-sm tabular-nums text-primary">
                    {Math.round(progress)}%
                  </span>
                </div>
                <Progress value={progress} className="mt-2.5 h-2" />
              </div>
            ) : null}
            <AdsterraBelowDownload />
          </div>

          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              onPointerDown={() => setCompare(true)}
              onPointerUp={() => setCompare(false)}
              onPointerLeave={() => setCompare(false)}
            >
              {t("holdOriginal")}
            </Button>
            <Button variant="secondary" onClick={redetect}>
              {t("redetect")}
            </Button>
            <Button variant="outline" onClick={clearMedia}>
              {t("newFile")}
            </Button>
          </div>
        </div>
      )}
      </div>

        <aside className="hidden w-[210px] shrink-0 lg:flex lg:flex-col lg:gap-8 lg:pt-8">
          <Polaroid src="/demo-after-gemini.jpg?v=5" label={t("after")} tilt="6deg" />
          <Polaroid src="/demo-after-dola.jpg" label={t("after")} tilt="-3deg" />
        </aside>
      </div>
    </section>
  );
}

function Polaroid({ src, label, tilt }: { src: string; label: string; tilt: string }) {
  return (
    <figure
      className="overflow-hidden rounded-2xl bg-surface p-2 shadow-float"
      style={{ transform: `rotate(${tilt})` }}
    >
      <img src={src} alt="" className="aspect-[3/4] w-full rounded-lg object-cover" />
      <figcaption className="flex items-center justify-between px-1.5 pt-2 pb-0.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-subtle">{label}</span>
        <SparkleMark className="size-4" />
      </figcaption>
    </figure>
  );
}

function Stepper({
  label,
  value,
  onMinus,
  onPlus,
}: {
  label: string;
  value: string;
  onMinus: () => void;
  onPlus: () => void;
}) {
  const holdRef = useRef<number | null>(null);
  const fnRef = useRef(onMinus);
  const startHold = (fn: () => void) => {
    fnRef.current = fn;
    fn();
    holdRef.current = window.setInterval(() => fnRef.current(), 90);
  };
  const stopHold = () => {
    if (holdRef.current != null) {
      window.clearInterval(holdRef.current);
      holdRef.current = null;
    }
  };
  return (
    <div className="flex h-9 select-none items-center gap-1">
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{label}</span>
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        onPointerDown={() => startHold(onMinus)}
        onPointerUp={stopHold}
        onPointerLeave={stopHold}
        onPointerCancel={stopHold}
        className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-2 text-fg transition-colors duration-150 hover:bg-primary-soft hover:text-primary"
      >
        <Minus className="size-3.5" />
      </button>
      <span className="w-14 shrink-0 text-center font-mono text-xs tabular-nums text-muted">{value}</span>
      <button
        type="button"
        aria-label={`Increase ${label}`}
        onPointerDown={() => startHold(onPlus)}
        onPointerUp={stopHold}
        onPointerLeave={stopHold}
        onPointerCancel={stopHold}
        className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-2 text-fg transition-colors duration-150 hover:bg-primary-soft hover:text-primary"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}

function ZoomCard({
  title,
  hint,
  tone,
  canvasRef,
  icon,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  title: string;
  hint?: string;
  tone: "orig" | "clean";
  canvasRef: RefObject<HTMLCanvasElement | null>;
  icon: ReactNode;
  onPointerDown?: (e: PointerEvent<HTMLDivElement>) => void;
  onPointerMove?: (e: PointerEvent<HTMLDivElement>) => void;
  onPointerUp?: () => void;
}) {
  return (
    <div
      className="rounded-xl bg-surface p-2 shadow-card"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div
        className={cn(
          "mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide",
          tone === "orig" ? "text-zoom-orig" : "text-zoom-clean",
        )}
      >
        {icon}
        {title}
      </div>
      <canvas
        ref={canvasRef}
        data-zoom={tone === "orig" ? "orig" : "clean"}
        className={cn(
          "mx-auto block size-28 rounded-md bg-surface-2",
          onPointerDown ? "touch-none cursor-grab active:cursor-grabbing" : "",
        )}
      />
      {hint ? <p className="mt-1 text-center text-xs text-subtle">{hint}</p> : null}
    </div>
  );
}

