export type ToolItem = {
  id: string;
  name: string;
  blurb: string;
  href: string;
  tag?: string;
  custom?: boolean;
};

/** Baked-in tools. Add more objects here to ship them to every visitor. */
export const BUILT_IN_TOOLS: ToolItem[] = [
  {
    id: "erazify",
    name: "Erazify",
    blurb: "Remove Gemini Veo sparkles and Dola AI wordmarks from photos and videos. 100% on-device.",
    href: "/#studio",
    tag: "On this site",
  },
];

const KEY = "erazify-my-tools";

export function loadMyTools(): ToolItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ToolItem[];
    return Array.isArray(parsed) ? parsed.filter((t) => t?.id && t?.name && t?.href) : [];
  } catch {
    return [];
  }
}

export function saveMyTools(tools: ToolItem[]) {
  window.localStorage.setItem(KEY, JSON.stringify(tools));
}

export function isSafeHref(href: string) {
  return /^(https?:\/\/|\/|#)/i.test(href.trim());
}
