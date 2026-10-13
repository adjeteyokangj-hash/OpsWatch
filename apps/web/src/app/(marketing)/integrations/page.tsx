import type { Metadata } from "next";
import { resolveMarketingPage } from "../../../content/marketing";
import { MarketingContentPage } from "../../../components/marketing/content-page";

export async function generateMetadata(): Promise<Metadata> {
  const page = await resolveMarketingPage("integrations");
  return {
    title: page?.metaTitle ?? "Integrations",
    description: page?.metaDescription
  };
}

export default async function IntegrationsMarketingPage() {
  const page = await resolveMarketingPage("integrations");
  if (!page) return null;
  return <MarketingContentPage page={page} />;
}
