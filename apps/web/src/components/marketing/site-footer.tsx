import Image from "next/image";
import Link from "next/link";
import { marketingSiteChrome } from "../../content/marketing";

export function SiteFooter() {
  return (
    <footer className="ow-footer">
      <div className="ow-footer-inner">
        <div className="ow-footer-brand">
          <Image
            src="/brand/opswatch-logo-light.png"
            alt="OpsWatch"
            width={180}
            height={42}
            className="ow-brand-logo"
          />
          <p>{marketingSiteChrome.productBlurb}</p>
          <div className="ow-footer-cta">
            <Link href="/register" className="ow-btn ow-btn-primary">
              Create account
            </Link>
            <Link href="/login" className="ow-btn ow-btn-ghost">
              Open Command Center
            </Link>
          </div>
        </div>

        <div className="ow-footer-cols">
          <div>
            <h2>Product</h2>
            <ul>
              {marketingSiteChrome.nav.map((item) => (
                <li key={item.href}>
                  <Link href={item.href}>{item.label}</Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2>Company</h2>
            <ul>
              {marketingSiteChrome.footerCompany.map((item) => (
                <li key={item.href}>
                  <Link href={item.href}>{item.label}</Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2>Get started</h2>
            <ul>
              {marketingSiteChrome.footerGetStarted.map((item) => (
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
        <p>{marketingSiteChrome.footerNote}</p>
      </div>
    </footer>
  );
}
