export const ADSTERRA_ORIGIN = "https://cabinetavidgrasp.com";

/**
 * Testing kill-switch. `false` = no banners, no social bar, no network to Adsterra.
 * Layout slots, unit keys, and refresh logic stay in the codebase.
 * Turn back to `true` when the user says ads can go live again.
 *
 * Slots (do not delete):
 * - Header: mobile 320×50 (`0aaabe317af95f2eea9461c1ec7813bb`) · desktop 728×90 (`5d1f5578f56dc4e84b0234bcdd14d6d2`)
 * - Rectangle 300×250 (5bfecede47e7217f619fd76d4fcd4056):
 *   Before upload, show below the Upload section. After upload, hide it there and show the same banner below the Download section.
 * - Desktop sky: 160×600 (`8a15189b1a1512bcb686a6660c836fc9`) ≥1024px
 * - Desktop footer: 468×60 (`3729f64dd04dec1b181ed531c50b4b84`)
 * - Desktop social bar: `a79f0f7a5a17f184676b8dc1d66ee21f.js`
 * - Banner refresh: recursive setTimeout 45–70s + cache-bust `?cb=`
 */
export const ADS_ENABLED = true;

export type AdUnit = {
  id: string;
  key: string;
  width: number;
  height: number;
};

export const AD_UNITS = {
  mobileHeader: {
    id: "320x50",
    key: "0aaabe317af95f2eea9461c1ec7813bb",
    width: 320,
    height: 50,
  },
  leaderboard: {
    id: "728x90",
    key: "5d1f5578f56dc4e84b0234bcdd14d6d2",
    width: 728,
    height: 90,
  },
  rectangle: {
    id: "300x250",
    key: "5bfecede47e7217f619fd76d4fcd4056",
    width: 300,
    height: 250,
  },
  skyscraper: {
    id: "160x600",
    key: "8a15189b1a1512bcb686a6660c836fc9",
    width: 160,
    height: 600,
  },
  footer: {
    id: "468x60",
    key: "3729f64dd04dec1b181ed531c50b4b84",
    width: 468,
    height: 60,
  },
} as const satisfies Record<string, AdUnit>;

export const SOCIAL_BAR_SRC = `${ADSTERRA_ORIGIN}/a7/9f/0f/a79f0f7a5a17f184676b8dc1d66ee21f.js`;

export function invokeSrc(key: string, bust = Date.now()) {
  return `${ADSTERRA_ORIGIN}/${key}/invoke.js?cb=${bust}&t=${bust}`;
}

/** Display banners rotate on this interval. Page itself never reloads. */
export const BANNER_REFRESH_MIN_MS = 45_000;
export const BANNER_REFRESH_MAX_MS = 70_000;
