import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { Studio } from "@/components/studio";
import { DesktopAdRail } from "@/components/adsterra";
import { AboutUs, ContactUs, Faq, HowItWorks, LegalTerms, PrivacyPolicy, SiteFooter, WhyChoose } from "@/components/landing-sections";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <div className="min-h-screen bg-bg">
      <SiteHeader />
      <div className="mx-auto w-full max-w-[1180px] px-0 lg:flex lg:items-start lg:gap-6 lg:px-6 xl:max-w-[1280px]">
        <div className="min-w-0 flex-1">
          <div className="mt-5 lg:mt-8">
            <Studio />
          </div>
          <WhyChoose />
          <HowItWorks />
          <Faq />
          <LegalTerms />
          <PrivacyPolicy />
          <ContactUs />
          <AboutUs />
        </div>
        <DesktopAdRail />
      </div>
      <SiteFooter />
    </div>
  );
}