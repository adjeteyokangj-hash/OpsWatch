import Image from "next/image";
import Link from "next/link";
import { MARKETING_FOOTER_LINKS, MARKETING_NAV } from "../../lib/marketing-nav";

export function SiteFooter() {
  return (
    <footer className="ow-footer">
      <div className="ow-footer-inner">
        <div className="ow-footer-brand">
          <Image
            src="/brand/opswatch-logo-light.png"
            alt="OpsWatch"
            width={148}
            height={36}
            className="ow-brand-logo"
          />
          <p>
            Agentless application health and incident remediation with an advanced topology
            foundation.
          </p>
        </div>

        <div className="ow-footer-cols">
          <div>
            <h2>Product</h2>
            <ul>
              {MARKETING_NAV.map((item) => (
                <li key={item.href}>
                  <Link href={item.href}>{item.label}</Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2>Company</h2>
            <ul>
              {MARKETING_FOOTER_LINKS.map((item) => (
                <li key={item.href}>
                  <Link href={item.href}>{item.label}</Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      <div className="ow-footer-base">
        <p>© {new Date().getFullYear()} OpsWatch. An Okang Group platform.</p>
      </div>
    </footer>
  );
}
