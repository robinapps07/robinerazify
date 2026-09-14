import type { ReactNode } from "react";
import { Download, ShieldCheck, Zap } from "lucide-react";
import { SparkleMark } from "@/components/sparkle-mark";
import { AdsterraFooter } from "@/components/adsterra";
import { useI18n } from "@/components/i18n-provider";

export function WhyChoose() {
  const { t } = useI18n();
  return (
    <section id="why" className="mx-auto max-w-lg scroll-mt-20 px-4 py-14 lg:max-w-none">
      <h2 className="text-center font-display text-3xl font-semibold tracking-tight lg:text-4xl">
        {t("whyTitle")}
      </h2>
      <ul className="mt-8 space-y-5 lg:grid lg:grid-cols-2 lg:gap-4 lg:space-y-0">
        <Point
          icon={<ShieldCheck className="size-5" />}
          title={t("whyLocalTitle")}
          body={t("whyLocalBody")}
        />
        <Point
          icon={<ShieldCheck className="size-5" />}
          title={t("whyNoUploadTitle")}
          body={t("whyNoUploadBody")}
        />
        <Point
          icon={<Zap className="size-5" />}
          title={t("whyFastTitle")}
          body={t("whyFastBody")}
        />
        <Point
          icon={<Download className="size-5" />}
          title={t("whyFreeTitle")}
          body={t("whyFreeBody")}
        />
      </ul>
    </section>
  );
}

function Point({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <li className="flex gap-3 rounded-2xl bg-surface p-4 shadow-card">
      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
        {icon}
      </span>
      <div>
        <h3 className="font-semibold tracking-tight">{title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>
      </div>
    </li>
  );
}

export function HowItWorks() {
  const { t } = useI18n();
  return (
    <section id="how" className="mx-auto max-w-lg scroll-mt-20 px-4 pb-10 lg:max-w-none">
      <h2 className="mb-6 text-center font-display text-2xl font-semibold tracking-tight lg:text-3xl">{t("howTitle")}</h2>
      <ol className="space-y-3 lg:grid lg:grid-cols-3 lg:gap-4 lg:space-y-0">
        <Step n={1} title={t("how1Title")} body={t("how1Body")} stepLabel={t("step")} />
        <Step n={2} title={t("how2Title")} body={t("how2Body")} stepLabel={t("step")} />
        <Step n={3} title={t("how3Title")} body={t("how3Body")} stepLabel={t("step")} />
      </ol>
    </section>
  );
}

function Step({ n, title, body, stepLabel }: { n: number; title: string; body: string; stepLabel: string }) {
  return (
    <li className="rounded-2xl bg-surface p-4 shadow-card">
      <span className="inline-flex rounded-full bg-primary-soft px-2.5 py-1 text-xs font-semibold text-primary">
        {stepLabel} {n}
      </span>
      <h3 className="mt-2 font-semibold">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>
    </li>
  );
}

export function Faq() {
  const { t } = useI18n();
  const items = [
    { q: t("faq1q"), a: t("faq1a") },
    { q: t("faq2q"), a: t("faq2a") },
    { q: t("faq3q"), a: t("faq3a") },
  ];
  return (
    <section id="faq" className="mx-auto max-w-lg scroll-mt-20 px-4 py-10 lg:max-w-3xl">
      <h2 className="text-center font-display text-2xl font-semibold tracking-tight">{t("faqTitle")}</h2>
      <dl className="mt-6 space-y-4">
        {items.map((it) => (
          <div key={it.q} className="rounded-2xl bg-surface p-4 shadow-card">
            <dt className="font-semibold">{it.q}</dt>
            <dd className="mt-1.5 text-sm leading-relaxed text-muted">{it.a}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function PolicyBlock({
  id,
  title,
  intro,
  items,
  close,
}: {
  id: string;
  title: string;
  intro?: string;
  items: Array<{ title: string; body: string }>;
  close?: string;
}) {
  return (
    <section id={id} className="mx-auto max-w-lg scroll-mt-20 px-4 pb-10 lg:max-w-3xl">
      <h2 className="text-center font-display text-2xl font-semibold tracking-tight">{title}</h2>
      {intro ? <p className="mt-4 text-sm leading-relaxed text-muted">{intro}</p> : null}
      <ol className="mt-6 space-y-4">
        {items.map((it) => (
          <li key={it.title} className="rounded-2xl bg-surface p-4 shadow-card">
            <h3 className="font-semibold">{it.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{it.body}</p>
          </li>
        ))}
      </ol>
      {close ? <p className="mt-5 text-sm leading-relaxed text-muted">{close}</p> : null}
    </section>
  );
}

export function LegalTerms() {
  const { t } = useI18n();
  return (
    <PolicyBlock
      id="legal"
      title={t("termsTitle")}
      intro={t("termsIntro")}
      items={[
        { title: t("terms1Title"), body: t("terms1Body") },
        { title: t("terms2Title"), body: t("terms2Body") },
        { title: t("terms3Title"), body: t("terms3Body") },
        { title: t("terms4Title"), body: t("terms4Body") },
        { title: t("terms5Title"), body: t("terms5Body") },
      ]}
    />
  );
}

export function PrivacyPolicy() {
  const { t } = useI18n();
  return (
    <PolicyBlock
      id="privacy"
      title={t("privacyTitle")}
      intro={t("privacyIntro")}
      items={[
        { title: t("privacy1Title"), body: t("privacy1Body") },
        { title: t("privacy2Title"), body: t("privacy2Body") },
        { title: t("privacy3Title"), body: t("privacy3Body") },
        { title: t("privacy4Title"), body: t("privacy4Body") },
        { title: t("privacy5Title"), body: t("privacy5Body") },
      ]}
      close={t("privacyClose")}
    />
  );
}

export function ContactUs() {
  const { t } = useI18n();
  return (
    <section id="contact" className="mx-auto max-w-lg scroll-mt-20 px-4 pb-10 lg:max-w-3xl">
      <h2 className="text-center font-display text-2xl font-semibold tracking-tight">{t("contactTitle")}</h2>
      <p className="mt-4 text-sm leading-relaxed text-muted">{t("contactIntro")}</p>
      <div className="mt-6 space-y-4">
        <div className="rounded-2xl bg-surface p-4 shadow-card">
          <h3 className="font-semibold">{t("contact1Title")}</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            {t("contact1Body").split("support@erazify.com").map((part, i, arr) =>
              i < arr.length - 1 ? (
                <span key={i}>
                  {part}
                  <a href="mailto:support@erazify.com" className="font-medium text-primary underline-offset-2 hover:underline">
                    support@erazify.com
                  </a>
                </span>
              ) : (
                <span key={i}>{part}</span>
              ),
            )}
          </p>
        </div>
        <div className="rounded-2xl bg-surface p-4 shadow-card">
          <h3 className="font-semibold">{t("contact2Title")}</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">{t("contact2Body")}</p>
        </div>
      </div>
      <p className="mt-5 text-sm leading-relaxed text-muted">{t("contactTip")}</p>
    </section>
  );
}

export function AboutUs() {
  const { t } = useI18n();
  return (
    <PolicyBlock
      id="about"
      title={t("aboutTitle")}
      intro={t("aboutIntro")}
      items={[
        { title: t("about1Title"), body: t("about1Body") },
        { title: t("about2Title"), body: t("about2Body") },
        { title: t("about3Title"), body: t("about3Body") },
      ]}
    />
  );
}

export function SiteFooter() {
  const { t } = useI18n();
  return (
    <>
      <AdsterraFooter />
      <footer className="border-t border-border py-10 text-center text-sm text-subtle">
      <a
        href="/"
        className="mb-3 flex items-center justify-center gap-2 text-fg"
        onClick={(e) => {
          e.preventDefault();
          window.location.assign("/");
        }}
      >
        <SparkleMark className="size-5" />
        <span className="font-semibold">Erazify</span>
      </a>
      <p>
        {t("footerLine")}
      </p>
      <nav className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs">
        <a href="/#about" className="text-fg underline-offset-2 hover:underline">
          {t("navAbout")}
        </a>
        <a href="/#privacy" className="text-fg underline-offset-2 hover:underline">
          {t("navPrivacy")}
        </a>
        <a href="/#legal" className="text-fg underline-offset-2 hover:underline">
          {t("navTerms")}
        </a>
        <a href="/#contact" className="text-fg underline-offset-2 hover:underline">
          {t("navContact")}
        </a>
      </nav>
    </footer>
    </>
  );
}

