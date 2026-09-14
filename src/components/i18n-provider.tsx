import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { detectLocale, persistLocale, translate, type Locale } from "@/lib/i18n";

type I18nCtx = {
  locale: Locale;
  setLocale: (id: Locale) => void;
  t: (key: string) => string;
};

const Ctx = createContext<I18nCtx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setLocaleState(detectLocale());
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    persistLocale(locale);
  }, [hydrated, locale]);
  const value = useMemo<I18nCtx>(
    () => ({
      locale,
      setLocale: (id) => {
        persistLocale(id);
        setLocaleState(id);
      },
      t: (key) => translate(locale, key),
    }),
    [locale],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useI18n needs I18nProvider");
  return ctx;
}
