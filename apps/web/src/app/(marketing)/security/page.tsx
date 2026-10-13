import type { Metadata } from "next";
import { resolveMarketingPage } from "../../../content/marketing";
import { MarketingContentPage } from "../../../components/marketing/content-page";

export async function generateMetadata(): Promise<Metadata> {
  const page = await resolveMarketingPage("security");
  return {
    title: page?.metaTitle ?? "Security",
    description: page?.metaDescription
  };
}

export default async function SecurityMarketingPage() {
  const page = await resolveMarketingPage("security");
  if (!page) return null;
  return <MarketingContentPage page={page} />;
}
