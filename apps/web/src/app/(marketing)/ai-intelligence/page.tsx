import type { Metadata } from "next";
import { resolveMarketingPage } from "../../../content/marketing";
import { MarketingContentPage } from "../../../components/marketing/content-page";

export async function generateMetadata(): Promise<Metadata> {
  const page = await resolveMarketingPage("ai-intelligence");
  return {
    title: page?.metaTitle ?? "AI Intelligence",
    description: page?.metaDescription
  };
}

export default async function AiIntelligencePage() {
  const page = await resolveMarketingPage("ai-intelligence");
  if (!page) return null;
  return <MarketingContentPage page={page} />;
}
