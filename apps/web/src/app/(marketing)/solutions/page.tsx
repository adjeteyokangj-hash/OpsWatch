import type { Metadata } from "next";
import { resolveMarketingPage } from "../../../content/marketing";
import { MarketingContentPage } from "../../../components/marketing/content-page";

export async function generateMetadata(): Promise<Metadata> {
  const page = await resolveMarketingPage("solutions");
  return {
    title: page?.metaTitle ?? "Solutions",
    description: page?.metaDescription
  };
}

export default async function SolutionsPage() {
  const page = await resolveMarketingPage("solutions");
  if (!page) return null;
  return <MarketingContentPage page={page} />;
}
