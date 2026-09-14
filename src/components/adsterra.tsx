import { useEffect, useRef, useState } from "react";
import {
  ADS_ENABLED,
  AD_UNITS,
  BANNER_REFRESH_MAX_MS,
  BANNER_REFRESH_MIN_MS,
  SOCIAL_BAR_SRC,
  invokeSrc,
  type AdUnit,
} from "@/lib/adsterra";

const DESKTOP_MQ = "(min-width: 769px)";
/** Skyscraper only when side margins can fit 160px without covering the tool. */
const RAIL_MQ = "(min-width: 1024px)";

function useMatch(query: string) {
  const [match, setMatch] = useState<boolean | null>(() =>
    typeof window === "undefined" ? null : window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const apply = () => setMatch(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [query]);
  return match;
}

function randomBannerDelay() {
  // 45000–60000 ms inclusive. Never a fixed 50s interval.
  return Math.floor(Math.random() * (BANNER_REFRESH_MAX_MS - BANNER_REFRESH_MIN_MS + 1)) + BANNER_REFRESH_MIN_MS;
}

/** Recursive setTimeout — each wait is a fresh random 45–60s. No setInterval. */
function useBannerTick() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let timer = 0;
    let cancelled = false;
    const schedule = () => {
      if (cancelled) return;
      const delay = randomBannerDelay();
      timer = window.setTimeout(() => {
        if (cancelled) return;
        if (document.visibilityState === "visible") setTick((n) => n + 1);
        schedule();
      }, delay);
    };
    schedule();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);
  return tick;
}

function fillBannerFrame(host: HTMLDivElement, unit: AdUnit) {
  host.replaceChildren();
  const iframe = document.createElement("iframe");
  iframe.title = "Advertisement";
  iframe.width = String(unit.width);
  iframe.height = String(unit.height);
  iframe.setAttribute("scrolling", "no");
  iframe.setAttribute("frameborder", "0");
  iframe.setAttribute("referrerpolicy", "no-referrer-when-downgrade");
  iframe.style.cssText = `width:${unit.width}px;height:${unit.height}px;border:0;overflow:hidden;display:block;`;
  host.appendChild(iframe);
  const doc = iframe.contentDocument;
  if (!doc) return;
  const bust = Date.now();
  const src = invokeSrc(unit.key, bust);
  doc.open();
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8">` +
      `<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">` +
      `<meta http-equiv="Pragma" content="no-cache">` +
      `<meta name="viewport" content="width=${unit.width}">` +
      `<style>html,body{margin:0;padding:0;overflow:hidden;background:transparent}</style></head><body>` +
      `<script>window.atOptions={key:${JSON.stringify(unit.key)},format:"iframe",height:${unit.height},width:${unit.width},params:{}};<\/script>` +
      `<script src="${src}"><\/script>` +
      `</body></html>`,
  );
  doc.close();
}

function AdsterraUnit({ unit }: { unit: AdUnit }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const tick = useBannerTick();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    fillBannerFrame(host, unit);
    return () => {
      host.replaceChildren();
    };
  }, [unit, tick]);

  return (
    <div
      ref={hostRef}
      className="adsterra-unit"
      data-ad-unit={unit.id}
      data-ad-tick={tick}
      style={{ width: unit.width, height: unit.height }}
    />
  );
}

/** Mobile 320×50 · Desktop 728×90. Only the matching unit is loaded. */
export function AdsterraHeader() {
  const desktop = useMatch(DESKTOP_MQ);
  if (!ADS_ENABLED) return null;
  return (
    <div className="adsterra-header">
      {desktop === false ? <AdsterraUnit unit={AD_UNITS.mobileHeader} /> : null}
      {desktop === true ? <AdsterraUnit unit={AD_UNITS.leaderboard} /> : null}
    </div>
  );
}

/** 300×250 under the download button — same on mobile and desktop. */
export function AdsterraBelowDownload() {
  if (!ADS_ENABLED) return null;
  return (
    <div className="adsterra-rect">
      <AdsterraUnit unit={AD_UNITS.rectangle} />
    </div>
  );
}

/** 160×600 — rendered inside DesktopAdRail, not as a fixed overlay. */
export function AdsterraSky() {
  if (!ADS_ENABLED) return null;
  return (
    <div className="adsterra-sky">
      <AdsterraUnit unit={AD_UNITS.skyscraper} />
    </div>
  );
}

/** 468×60 desktop footer only. */
export function AdsterraFooter() {
  const desktop = useMatch(DESKTOP_MQ);
  if (!ADS_ENABLED || !desktop) return null;
  return (
    <div className="adsterra-footer">
      <AdsterraUnit unit={AD_UNITS.footer} />
    </div>
  );
}

/** Social Bar — desktop only. Never injected on mobile. */
export function AdsterraSocial() {
  const desktop = useMatch(DESKTOP_MQ);
  useEffect(() => {
    if (!ADS_ENABLED || !desktop) return;
    if (document.getElementById("adsterra-social")) return;
    const s = document.createElement("script");
    s.id = "adsterra-social";
    s.async = true;
    s.src = SOCIAL_BAR_SRC;
    document.body.appendChild(s);
  }, [desktop]);
  return null;
}

export function AdsterraChrome() {
  if (!ADS_ENABLED) return null;
  return <AdsterraSocial />;
}

/** Right-hand desktop column. Hidden on mobile. No empty box while ads are off. */
export function DesktopAdRail() {
  const show = useMatch(RAIL_MQ);
  if (!ADS_ENABLED || !show) return null;
  return (
    <aside className="desktop-ad-rail hidden w-[160px] shrink-0 lg:block">
      <div className="sticky top-20 h-[600px]">
        <AdsterraSky />
      </div>
    </aside>
  );
}
