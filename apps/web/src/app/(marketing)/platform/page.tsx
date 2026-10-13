import type { Metadata } from "next";
import { resolveMarketingPage } from "../../../content/marketing";
import { MarketingContentPage } from "../../../components/marketing/content-page";

export async function generateMetadata(): Promise<Metadata> {
  const page = await resolveMarketingPage("platform");
  return {
    title: page?.metaTitle ?? "Platform",
    description: page?.metaDescription
  };
}

export default async function PlatformPage() {
  const page = await resolveMarketingPage("platform");
  if (!page) return null;
  return <MarketingContentPage page={page} />;
}
