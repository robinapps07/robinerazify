import { useEffect, useRef, useState } from "react";
import {
  Bell,
  Clapperboard,
  HelpCircle,
  Images,
  Info,
  Lock,
  Mail,
  Moon,
  Scale,
  ScanSearch,
  Shield,
  Sparkles,
  Sun,
  Wrench,
  X,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { SparkleMark } from "@/components/sparkle-mark";
import { Button } from "@/components/ui/button";
import { applyTheme, readTheme, type ThemeMode } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { AdsterraChrome, AdsterraHeader } from "@/components/adsterra";
import { useI18n } from "@/components/i18n-provider";
import { LOCALE_META } from "@/lib/i18n";

const BMC_URL = "https://www.buymeacoffee.com/erazify";

function TranslateMark() {
  return (
    <span className="relative inline-block h-[18px] w-[22px] shrink-0" aria-hidden="true">
      <span className="absolute left-0 top-[-2px] text-[16px] font-light leading-none text-current">文</span>
      <span className="absolute bottom-[-1px] right-0 text-[13px] font-semibold leading-none text-current">A</span>
    </span>
  );
}

function MenuMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" fill="none" aria-hidden="true">
      <path d="M3 7h18" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" />
      <path d="M7 12h10" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" />
      <path d="M3 17h18" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" />
    </svg>
  );
}

export function SiteHeader() {
  const { t, locale, setLocale } = useI18n();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(false);
  const [langs, setLangs] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const notesRef = useRef<HTMLDivElement>(null);
  const langRef = useRef<HTMLDivElement>(null);

  const links = [
    { href: "/tools", label: t("tools"), icon: Wrench },
    { href: "/#studio", label: t("navStudio"), icon: ScanSearch },
    { href: "/#why", label: t("navWhy"), icon: Shield },
    { href: "/#how", label: t("navHow"), icon: Sparkles },
    { href: "/#faq", label: t("navFaq"), icon: HelpCircle },
    { href: "/#legal", label: t("navTerms"), icon: Scale },
    { href: "/#privacy", label: t("navPrivacy"), icon: Lock },
    { href: "/#contact", label: t("navContact"), icon: Mail },
    { href: "/#about", label: t("navAbout"), icon: Info },
  ];

  const notesList = [
    { title: t("noteLocalTitle"), body: t("noteLocalBody") },
    { title: t("noteDetectTitle"), body: t("noteDetectBody") },
  ];

  useEffect(() => {
    const mode = readTheme();
    applyTheme(mode);
    setTheme(mode);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!notes && !langs) return;
    const onDoc = (e: MouseEvent) => {
      const n = e.target as Node;
      if (notes && !notesRef.current?.contains(n)) setNotes(false);
      if (langs && !langRef.current?.contains(n)) setLangs(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [notes, langs]);

  return (
    <>
      <header className="sticky top-0 z-40 h-16 border-b border-border/80 bg-surface/95 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1280px] items-center px-3 sm:px-4 lg:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 [&_svg]:size-6"
            aria-label={open ? t("closeMenu") : t("openMenu")}
            aria-expanded={open}
            aria-controls="site-drawer"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="size-6" /> : <MenuMark />}
          </Button>

          <a
            href="/"
            className="ml-1 flex min-w-0 items-center gap-2.5 font-semibold tracking-tight sm:ml-3"
            onClick={(e) => {
              e.preventDefault();
              window.location.assign("/");
            }}
          >
            <SparkleMark className="size-10 shrink-0 sm:size-11" />
            <span className="truncate font-display text-base sm:text-lg">Erazify</span>
          </a>

          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <div className="relative" ref={notesRef}>
              <Button
                variant="ghost"
                size="icon"
                className="size-10 rounded-full"
                aria-label={t("notifications")}
                aria-expanded={notes}
                onClick={() => {
                  setLangs(false);
                  setNotes((v) => !v);
                }}
              >
                <Bell className="size-[18px]" />
                <span className="absolute right-2.5 top-2.5 size-1.5 rounded-full bg-primary" />
              </Button>
              {notes ? (
                <div className="fixed left-1/2 top-20 z-50 w-[min(18rem,calc(100vw-1.5rem))] -translate-x-1/2 rounded-xl bg-surface p-2 shadow-float sm:absolute sm:left-auto sm:right-0 sm:top-12 sm:w-72 sm:translate-x-0">
                  <p className="px-2 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wide text-subtle">
                    {t("notifications")}
                  </p>
                  <ul className="space-y-1">
                    {notesList.map((n) => (
                      <li key={n.title} className="rounded-lg px-2 py-2">
                        <p className="text-sm font-medium">{n.title}</p>
                        <p className="text-xs leading-relaxed text-muted">{n.body}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>

            <Button
              variant="ghost"
              size="icon"
              className="size-10 rounded-full"
              aria-label={theme === "dark" ? t("lightMode") : t("nightMode")}
              onClick={() => {
                const next: ThemeMode = theme === "dark" ? "light" : "dark";
                applyTheme(next);
                setTheme(next);
              }}
            >
              {theme === "dark" ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
            </Button>

            <div className="relative" ref={langRef}>
              <button
                type="button"
                aria-label={t("translate")}
                aria-expanded={langs}
                title={t("translate")}
                onClick={() => {
                  setNotes(false);
                  setLangs((v) => !v);
                }}
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-1.5 text-fg transition-[opacity,background-color,transform] duration-150 hover:bg-surface-2 active:scale-95 sm:h-10 sm:px-2"
              >
                <TranslateMark />
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] sm:text-xs">
                  {LOCALE_META.find((m) => m.id === locale)?.code ?? "EN"}
                </span>
              </button>
              {langs ? (
                <div className="fixed left-1/2 top-20 z-50 w-[min(16.5rem,calc(100vw-1.5rem))] -translate-x-1/2 rounded-xl bg-surface p-1.5 shadow-float sm:absolute sm:left-auto sm:right-0 sm:top-12 sm:w-56 sm:translate-x-0">
                  {LOCALE_META.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setLocale(item.id);
                        setLangs(false);
                      }}
                      className={cn(
                        "flex h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm transition-colors duration-150",
                        locale === item.id ? "bg-primary-soft font-semibold text-primary" : "text-fg hover:bg-surface-2",
                      )}
                    >
                      <span className="text-base leading-none" aria-hidden="true">
                        {item.flag}
                      </span>
                      <span className="truncate">{item.native}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <a
              href={BMC_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("bmc")}
              title={t("bmc")}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#FFDD00] shadow-sm transition-[opacity,transform] duration-150 ease-out hover:opacity-90 active:scale-95 sm:size-10"
            >
              <img src="/bmc-cup.svg" alt="" width={18} height={26} className="h-[22px] w-[15px] sm:h-[24px] sm:w-4" />
            </a>
          </div>
        </div>
      </header>
      <AdsterraHeader />
      <AdsterraChrome />

      <div
        className={cn(
          "fixed inset-0 z-50 bg-fg/30 transition-opacity duration-200 ease-out",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={() => setOpen(false)}
        aria-hidden={!open}
      />

      <aside
        id="site-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Site menu"
        aria-hidden={!open}
        inert={!open}
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-surface shadow-float transition-transform duration-200 ease-out",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center gap-2 border-b border-border px-4">
          <a
            href="/"
            className="flex min-w-0 items-center gap-2"
            onClick={(e) => {
              e.preventDefault();
              window.location.assign("/");
            }}
          >
            <SparkleMark className="size-8" />
            <span className="font-semibold">Erazify</span>
          </a>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto"
            aria-label={t("closeMenu")}
            onClick={() => setOpen(false)}
          >
            <X />
          </Button>
        </div>
        <nav className="flex flex-col gap-1 p-3">
          {links.map((l) => {
            const Icon = l.icon;
            return (
              <a
                key={l.label}
                href={l.href}
                onClick={() => setOpen(false)}
                className="flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium text-fg transition-colors duration-150 hover:bg-surface-2"
              >
                <Icon className="size-4 text-muted" />
                {l.label}
              </a>
            );
          })}
        </nav>
      </aside>
    </>
  );
}

export function MediaToggle({
  mode,
  onChange,
}: {
  mode: "image" | "video";
  onChange: (m: "image" | "video") => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex w-full rounded-full bg-surface-2 p-1">
      <button
        type="button"
        onClick={() => onChange("image")}
        className={cn(
          "flex h-11 flex-1 items-center justify-center gap-2 rounded-full text-sm font-medium transition-colors duration-150",
          mode === "image" ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg",
        )}
      >
        <Images className="size-4" />
        {t("imageRemover")}
      </button>
      <button
        type="button"
        onClick={() => onChange("video")}
        className={cn(
          "flex h-11 flex-1 items-center justify-center gap-2 rounded-full text-sm font-medium transition-colors duration-150",
          mode === "video" ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg",
        )}
      >
        <Clapperboard className="size-4" />
        {t("videoRemover")}
      </button>
    </div>
  );
}
