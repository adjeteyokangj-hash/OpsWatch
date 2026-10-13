"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { marketingSiteChrome } from "../../content/marketing";

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="ow-header">
      <div className="ow-header-inner">
        <Link href="/" className="ow-brand" aria-label="OpsWatch home">
          <Image
            src="/brand/opswatch-logo-light.png"
            alt="OpsWatch"
            width={240}
            height={56}
            className="ow-brand-logo"
            priority
          />
        </Link>

        <button
          type="button"
          className="ow-nav-toggle"
          aria-expanded={open}
          aria-controls="ow-primary-nav"
          onClick={() => setOpen((value) => !value)}
        >
          <span className="ow-sr-only">Menu</span>
          <span />
          <span />
          <span />
        </button>

        <nav id="ow-primary-nav" className={`ow-nav${open ? " is-open" : ""}`} aria-label="Primary">
          {marketingSiteChrome.nav.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? "is-active" : undefined}
                onClick={() => setOpen(false)}
              >
                {item.label}
              </Link>
            );
          })}
          <div className="ow-nav-actions">
            <Link href="/login" className="ow-btn ow-btn-ghost" onClick={() => setOpen(false)}>
              Sign in
            </Link>
            <Link href="/register" className="ow-btn ow-btn-primary" onClick={() => setOpen(false)}>
              Start monitoring
            </Link>
          </div>
        </nav>
      </div>
    </header>
  );
}
