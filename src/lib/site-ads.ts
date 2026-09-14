/** Paste click-out URLs here so every visitor sees them (GitHub deploy). */
export type AdPlacement = "homeTop" | "homeBottom" | "toolsTop" | "toolsFeed" | "toolsBottom";

export type AdEntry = {
  href: string;
  label?: string;
  image?: string;
};

export const DEFAULT_ADS: Partial<Record<AdPlacement, AdEntry>> = {
  // Paste later, e.g.:
  // homeTop: { href: "https://your-link.com", label: "Sponsored" },
};

const KEY = "erazify-ads";

export function loadCustomAds(): Partial<Record<AdPlacement, AdEntry>> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<Record<AdPlacement, AdEntry>>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveCustomAds(next: Partial<Record<AdPlacement, AdEntry>>) {
  window.localStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new Event("erazify-ads"));
}

export function getAd(placement: AdPlacement): AdEntry | null {
  const custom = loadCustomAds()[placement];
  if (custom?.href) return custom;
  const baked = DEFAULT_ADS[placement];
  return baked?.href ? baked : null;
}

/** Paste a pop URL later. Empty = download does not open anything extra. */
export const DOWNLOAD_POP_URL = "";

export function openDownloadPop() {
  if (typeof window === "undefined") return;
  const href = DOWNLOAD_POP_URL.trim();
  if (!href) return;
  try {
    window.open(href, "erazify_dl");
  } catch {
    /* ignore */
  }
}

export const AD_PLACEMENTS: Array<{ id: AdPlacement; label: string }> = [
  { id: "homeTop", label: "Home · top banner" },
  { id: "homeBottom", label: "Home · bottom box" },
  { id: "toolsTop", label: "Tools · header banner" },
  { id: "toolsFeed", label: "Tools · in-feed" },
  { id: "toolsBottom", label: "Tools · bottom box" },
];
