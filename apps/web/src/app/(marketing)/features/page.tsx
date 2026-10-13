import type { Metadata } from "next";
import { resolveMarketingPage } from "../../../content/marketing";
import { MarketingContentPage } from "../../../components/marketing/content-page";

export async function generateMetadata(): Promise<Metadata> {
  const page = await resolveMarketingPage("features");
  return {
    title: page?.metaTitle ?? "Features",
    description: page?.metaDescription
  };
}

export default async function FeaturesPage() {
  const page = await resolveMarketingPage("features");
  if (!page) return null;
  return <MarketingContentPage page={page} />;
}
