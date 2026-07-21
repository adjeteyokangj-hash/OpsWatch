"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Shell } from "../../components/layout/shell";
import { Header } from "../../components/layout/header";

// Global workspace subscription has been removed. Billing is per application:
// each application manages its own plan, limits and payment under its Billing tab.
export default function SubscriptionRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/projects");
  }, [router]);

  return (
    <Shell>
      <Header title="Billing moved" />
      <section className="panel">
        <p>
          OpsWatch bills per application. Open an application and use its Billing tab to view its plan, usage,
          payment method and invoices. Other applications keep independent plans and pricing.
        </p>
      </section>
    </Shell>
  );
}
