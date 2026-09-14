export const ENGINE_IDS = [
  "auto",
  "gemini",
  "grok",
  "banner",
  "dola",
  "chatgpt",
  "flux",
  "ideogram",
  "midjourney",
  "sora",
  "generic",
] as const;

export type EngineId = (typeof ENGINE_IDS)[number];

export type MapKind =
  | "sparkle"
  | "grok"
  | "grokBanner"
  | "dola"
  | "chatgpt"
  | "flux"
  | "ideogram"
  | "midjourney"
  | "sora"
  | "veo"
  | "generic";

export type Placement = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ExtraBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DetectParams = {
  engine: EngineId;
  gain: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  size: number;
  anchorX: number;
  anchorY: number;
  darkOutline: boolean;
  heal: number;
  mapId?: string;
  mapW?: number;
  mapH?: number;
  extras?: ExtraBox[];
};

export type DetectionHit = {
  engine: Exclude<EngineId, "auto">;
  confidence: number;
  size: number;
  x: number;
  y: number;
  gain: number;
  polarity: "light" | "dark";
  mapKind: MapKind;
  mapId: string;
  mapW: number;
  mapH: number;
  method: "unblend" | "fill";
  extras?: ExtraBox[];
};

export type EngineMeta = {
  id: EngineId;
  label: string;
  hint: string;
  mapKind: MapKind | "auto";
};

export const GEMINI_DEFAULT_GAIN = 0.48;
/** 3:4 1K 896×1200 and 2K 1792×2400 — user-tuned unblend. */
export const GEMINI_34_GAIN = 0.8;
/** WhatsApp/email 1:1 1600×1600 — locked. */
export const GEMINI_1600_GAIN = 0.82;
export const GROK_DEFAULT_GAIN = 0.62;

export const ENGINES: EngineMeta[] = [
  { id: "auto", label: "Auto", hint: "Picks Gemini sparkle or Dola AI wordmark", mapKind: "auto" },
  { id: "gemini", label: "Gemini / Veo", hint: "Captured 4-point sparkle maps — reverse-blend, pixels come back", mapKind: "sparkle" },
  { id: "dola", label: "Dola AI", hint: "Bottom-right “Dola AI” text — colour-drilled out, scene stays", mapKind: "dola" },
  { id: "grok", label: "Grok", hint: "Bottom-right Grok lockup — soft-blurred into the scene", mapKind: "grok" },
];

export const STUDIO_ENGINE_IDS: EngineId[] = ["auto", "gemini", "dola", "grok"];

export function engineById(id: EngineId): EngineMeta {
  return ENGINES.find((e) => e.id === id) ?? ENGINES[0]!;
}

export function mapKindForEngine(id: Exclude<EngineId, "auto">): MapKind {
  if (id === "gemini") return "sparkle";
  if (id === "banner") return "grokBanner";
  return id;
}

export function usesFill(kind: MapKind, engine?: EngineId): boolean {
  if (kind === "grok" || kind === "grokBanner" || kind === "dola" || kind === "generic") return true;
  if (engine === "grok" || engine === "banner" || engine === "dola" || engine === "generic") return true;
  return false;
}

export type ProcessResult = {
  imageData: ImageData;
  hit: DetectionHit | null;
};
