import { ExternalLink } from "lucide-react";
import { SparkleMark } from "@/components/sparkle-mark";
import { BUILT_IN_TOOLS } from "@/lib/tools-catalog";
import { useI18n } from "@/components/i18n-provider";

export function ToolsDirectory() {
  const { t } = useI18n();
  return (
    <div className="mx-auto w-full max-w-lg px-4 pb-10 pt-6">
      <header className="mb-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-subtle">{t("dirLabel")}</p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">{t("moreTools")}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">{t("dirBlurb")}</p>
      </header>

      <ul className="space-y-3">
        {BUILT_IN_TOOLS.map((item) => (
          <li key={item.id}>
            <article className="flex gap-3 rounded-2xl bg-surface p-4 shadow-card">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                {item.id === "erazify" ? (
                  <SparkleMark className="size-6" />
                ) : (
                  <span className="text-lg font-semibold">{item.name.slice(0, 1)}</span>
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2">
                  <h2 className="min-w-0 flex-1 font-semibold tracking-tight">{item.name}</h2>
                  {item.tag ? (
                    <span className="shrink-0 rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">
                      {item.id === "erazify" ? t("onThisSite") : item.tag}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-sm leading-relaxed text-muted">
                  {item.id === "erazify" ? t("toolBlurb") : item.blurb}
                </p>
                <a
                  href={item.href}
                  target={item.href.startsWith("http") ? "_blank" : undefined}
                  rel={item.href.startsWith("http") ? "noopener noreferrer" : undefined}
                  className="mt-3 inline-flex h-10 items-center gap-1.5 rounded-full bg-primary px-3.5 text-sm font-semibold text-primary-fg transition-[opacity,transform] duration-150 hover:opacity-90 active:scale-95"
                >
                  {t("open")}
                  {item.href.startsWith("http") ? <ExternalLink className="size-3.5" /> : null}
                </a>
              </div>
            </article>
          </li>
        ))}
      </ul>
    </div>
  );
}