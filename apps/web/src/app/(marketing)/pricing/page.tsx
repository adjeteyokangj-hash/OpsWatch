import type { Metadata } from "next";
import { resolveMarketingPage } from "../../../content/marketing";
import { MarketingContentPage } from "../../../components/marketing/content-page";

export async function generateMetadata(): Promise<Metadata> {
  const page = await resolveMarketingPage("pricing");
  return {
    title: page?.metaTitle ?? "Pricing",
    description: page?.metaDescription
  };
}

export default async function PricingPage() {
  const page = await resolveMarketingPage("pricing");
  if (!page) return null;
  return <MarketingContentPage page={page} />;
}
