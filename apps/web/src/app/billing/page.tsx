"use client";

import { useEffect, useState } from "react";
import { Shell } from "../../components/layout/shell";
import { Header } from "../../components/layout/header";
import { apiFetch } from "../../lib/api";

type PlanInfo = {
  id: string;
  limits: { projects: number; checks: number; users: number; retention: number };
  price: { monthly: number; currency: string };
};

type BillingInfo = {
  organization: { id: string; name: string; plan: string };
  limits: { projects: number; checks: number; users: number; retention: number };
  usage: { projects: number; users: number; checks: number };
  price: { monthly: number; currency: string };
  plans: PlanInfo[];
};

const PLAN_LABELS: Record<string, string> = {
  FREE: "Free",
  STARTER: "Starter",
  PRO: "Pro",
  ENTERPRISE: "Enterprise"
};

export default function BillingPage() {
  const [info, setInfo] = useState<BillingInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<BillingInfo>("/billing");
      setInfo(data);
    } catch (err: any) {
      setError(err?.message || "Failed to load billing info");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleUpgrade = async (planId: string) => {
    setUpgrading(planId);
    setError(null);
    setMessage(null);
    try {
      const result = await apiFetch<{ message: string }>("/billing/upgrade", {
        method: "POST",
        body: JSON.stringify({ plan: planId })
      });
      setMessage(result.message);
      await load();
    } catch (err: any) {
      setError(err?.message || "Failed to upgrade plan");
    } finally {
      setUpgrading(null);
    }
  };

  const usagePercent = (used: number, limit: number) =>
    limit >= 9999 ? 0 : Math.min(100, Math.round((used / limit) * 100));

  return (
    <Shell>
      <Header title="Billing &amp; Plan" />
      {error ? <section className="panel error-panel">{error}</section> : null}
      {message ? <section className="panel success-panel">{message}</section> : null}

      {loading ? (
        <p>Loading billing info...</p>
      ) : info ? (
        <>
          <section className="three-col">
            <article className="panel metric-card">
              <div className="metric-label">Current plan</div>
              <div className="metric-value">{PLAN_LABELS[info.organization.plan] || info.organization.plan}</div>
            </article>
            <article className="panel metric-card">
              <div className="metric-label">Monthly cost</div>
              <div className="metric-value">
                {info.price.monthly === 0 ? "Free" : `$${info.price.monthly}`}
              </div>
            </article>
            <article className="panel metric-card">
              <div className="metric-label">Data retention</div>
              <div className="metric-value">{info.limits.retention} days</div>
            </article>
          </section>

          <section className="two-col">
            <section className="panel">
              <div className="section-head">
                <div>
                  <h2>Usage</h2>
                  <p>Your resource usage against current plan limits.</p>
                </div>
              </div>
              <div className="usage-list">
                {(["projects", "users", "checks"] as const).map((res) => (
                  <div key={res} className="usage-row">
                    <div className="usage-label">
                      <span className="usage-name">{res.charAt(0).toUpperCase() + res.slice(1)}</span>
                      <span className="usage-count">
                        {info.usage[res]} / {info.limits[res] >= 9999 ? "∞" : info.limits[res]}
                      </span>
                    </div>
                    <div className="usage-bar-track">
                      <div
                        className="usage-bar-fill"
                        style={{ width: `${usagePercent(info.usage[res], info.limits[res])}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel">
              <div className="section-head">
                <div>
                  <h2>Available plans</h2>
                  <p>Upgrade to unlock more resources.</p>
                </div>
              </div>
              <div className="plan-list">
                {info.plans.map((plan) => {
                  const isCurrent = plan.id === info.organization.plan;
                  return (
                    <div key={plan.id} className={`plan-card${isCurrent ? " plan-card--current" : ""}`}>
                      <div className="plan-head">
                        <strong>{PLAN_LABELS[plan.id] || plan.id}</strong>
                        {isCurrent ? <span className="plan-badge">Current</span> : null}
                      </div>
                      <div className="plan-price">
                        {plan.price.monthly === 0 ? "Free" : `$${plan.price.monthly}/mo`}
                      </div>
                      <ul className="plan-features">
                        <li>{plan.limits.projects >= 9999 ? "Unlimited" : plan.limits.projects} projects</li>
                        <li>{plan.limits.checks >= 9999 ? "Unlimited" : plan.limits.checks} checks</li>
                        <li>{plan.limits.users >= 9999 ? "Unlimited" : plan.limits.users} users</li>
                        <li>{plan.limits.retention} day retention</li>
                      </ul>
                      {!isCurrent ? (
                        <button
                          className="primary-button"
                          disabled={upgrading === plan.id}
                          onClick={() => void handleUpgrade(plan.id)}
                        >
                          {upgrading === plan.id ? "Upgrading..." : "Select plan"}
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          </section>
        </>
      ) : null}
    </Shell>
  );
}
