import type { Metadata } from "next";
import { getMarketingPage } from "../../../content/marketing";
import { MarketingContentPage } from "../../../components/marketing/content-page";

const page = getMarketingPage("ai-intelligence")!;

export const metadata: Metadata = {
  title: page.metaTitle,
  description: page.metaDescription
};

export default function AiIntelligencePage() {
  return <MarketingContentPage page={page} />;
}
