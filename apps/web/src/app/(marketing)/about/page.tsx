import type { Metadata } from "next";
import { resolveMarketingPage } from "../../../content/marketing";
import { MarketingContentPage } from "../../../components/marketing/content-page";

export async function generateMetadata(): Promise<Metadata> {
  const page = await resolveMarketingPage("about");
  return {
    title: page?.metaTitle ?? "About",
    description: page?.metaDescription
  };
}

export default async function AboutPage() {
  const page = await resolveMarketingPage("about");
  if (!page) return null;
  return <MarketingContentPage page={page} />;
}
