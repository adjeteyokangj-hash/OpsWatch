import type { Metadata } from "next";
import { getMarketingPage } from "../../../content/marketing";
import { MarketingContentPage } from "../../../components/marketing/content-page";

const page = getMarketingPage("security")!;

export const metadata: Metadata = {
  title: page.metaTitle,
  description: page.metaDescription
};

export default function SecurityMarketingPage() {
  return <MarketingContentPage page={page} />;
}
