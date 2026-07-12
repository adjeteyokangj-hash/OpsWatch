"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Shell } from "../../components/layout/shell";
import { Header } from "../../components/layout/header";

export default function BillingRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/projects");
  }, [router]);

  return (
    <Shell>
      <Header title="Billing moved" />
      <section className="panel">
        <p>Billing is configured per project. Open a project and use the Billing tab.</p>
      </section>
    </Shell>
  );
}
