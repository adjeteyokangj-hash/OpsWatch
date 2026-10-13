import type { ReactNode } from "react";
import type { Metadata } from "next";
import { SiteHeader } from "../../components/marketing/site-header";
import { SiteFooter } from "../../components/marketing/site-footer";
import "../../styles/marketing.css";

export const metadata: Metadata = {
  title: {
    default: "OpsWatch",
    template: "%s | OpsWatch"
  },
  description:
    "Agentless application health and incident remediation platform with an advanced topology foundation."
};

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="ow-site">
      <SiteHeader />
      <main className="ow-main">{children}</main>
      <SiteFooter />
    </div>
  );
}
