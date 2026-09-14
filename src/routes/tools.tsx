import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { ToolsDirectory } from "@/components/tools-directory";
import { SiteFooter } from "@/components/landing-sections";

export const Route = createFileRoute("/tools")({ component: ToolsPage });

function ToolsPage() {
  return (
    <div className="min-h-screen bg-bg">
      <SiteHeader />
      <ToolsDirectory />
      <SiteFooter />
    </div>
  );
}
