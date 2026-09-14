import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { getAd, type AdPlacement } from "@/lib/site-ads";

type AdKind = "top" | "bottom" | "feed";

const KIND_PLACEMENT: Record<AdKind, AdPlacement> = {
  top: "homeTop",
  bottom: "homeBottom",
  feed: "toolsFeed",
};

/** Invisible hook until a link is set. Layout does not reserve empty boxes. */
export function AdSlot({ kind, placement }: { kind: AdKind; placement?: AdPlacement }) {
  const slot = placement ?? KIND_PLACEMENT[kind];
  const [ad, setAd] = useState<ReturnType<typeof getAd>>(null);

  useEffect(() => {
    const read = () => setAd(getAd(slot));
    read();
    window.addEventListener("erazify-ads", read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener("erazify-ads", read);
      window.removeEventListener("storage", read);
    };
  }, [slot]);

  if (!ad?.href) {
    return <aside id={`ad-${slot}`} data-ad-slot={slot} className="contents" />;
  }

  const boxClass = kind === "top" ? "ad-slot-top" : kind === "feed" ? "ad-slot-feed" : "ad-slot-bottom";

  return (
    <aside id={`ad-${slot}`} data-ad-slot={slot} className="flex w-full justify-center px-4 py-3">
      <a
        href={ad.href}
        target="_blank"
        rel="noopener noreferrer sponsored"
        className={cn(
          "flex items-center justify-center overflow-hidden rounded-lg text-center text-sm font-medium tracking-tight",
          boxClass,
        )}
      >
        {ad.image ? (
          <img src={ad.image} alt={ad.label || "Sponsored"} className="size-full object-cover" />
        ) : (
          <span>{ad.label || "Sponsored"}</span>
        )}
      </a>
    </aside>
  );
}
