"use client";

import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Shell } from "../../components/layout/shell";
import { Header } from "../../components/layout/header";
import { apiFetch } from "../../lib/api";
import { FilterPresets, type FilterPreset } from "../../components/ui/filter-presets";
import { CopyFilterLink } from "../../components/ui/copy-filter-link";
import { StatCard } from "../../components/dashboard/stat-card";

type ServiceOption = {
  id: string;
  name: string;
  baseUrl?: string | null;
  project: { id: string; name: string };
};

type ProjectOption = {
  id: string;
  name: string;
  services: ServiceOption[];
};

type CheckResultDto = {
  id: string;
  status: string;
  responseCode: number | null;
  responseTimeMs: number | null;
  message: string | null;
  checkedAt: string;
};

type CheckListItemDto = {
  id: string;
  name: string;
  type: string;
  intervalSeconds: number;
  timeoutMs: number;
  isActive: boolean;
  service: {
    id: string;
    name: string;
    project: { id: string; name: string };
  };
  latestResult: CheckResultDto | null;
};

type CheckStatusSummaryDto = {
  total: number;
  pass: number;
  fail: number;
  warn: number;
  pending: number;
};

type CheckListResponse = {
  items: CheckListItemDto[];
  summary: CheckStatusSummaryDto;
};

type LegacyCheckListResponse = CheckListItemDto[];

const CHECKS_PRESETS: FilterPreset[] = [
  { label: "Failing", params: { latestStatus: "FAIL" } },
  { label: "Warnings", params: { latestStatus: "WARN" } },
  { label: "Passing", params: { latestStatus: "PASS" } },
  { label: "Pending", params: { latestStatus: "PENDING" } },
  { label: "Inactive", params: { isActive: "false" } }
];

// CheckRow kept for backwards compat inside this file
type CheckRow = CheckListItemDto;

const EMPTY_FORM = {
  serviceId: "",
  name: "",
  type: "HTTP",
  intervalSeconds: 300,
  timeoutMs: 5000,
  expectedStatusCode: 200,
  expectedKeyword: "",
  maxResponseTimeMs: 3000,
  failureThreshold: 3,
  recoveryThreshold: 2
};

function ChecksPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [checks, setChecks] = useState<CheckRow[]>([]);
  const [serverSummary, setServerSummary] = useState<CheckStatusSummaryDto | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const latestStatusFilter = searchParams.get("latestStatus") || "";
  const projectIdFilter = searchParams.get("projectId") || "";
  const serviceIdFilter = searchParams.get("serviceId") || "";
  const isActiveFilter = searchParams.get("isActive") || "";

  const loadChecks = async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams(searchParams.toString());
      if (query.get("latestStatus") === "PENDING") {
        query.delete("latestStatus");
      }
      const [response, projectRows] = await Promise.all([
        apiFetch<CheckListResponse | LegacyCheckListResponse>(`/checks${query.toString() ? `?${query.toString()}` : ""}`),
        apiFetch<ProjectOption[]>("/projects")
      ]);
      if (Array.isArray(response)) {
        setChecks(response);
        setServerSummary(null);
      } else {
        setChecks(response.items || []);
        setServerSummary(response.summary || null);
      }
      setProjects(projectRows);
    } catch (loadError: any) {
      setError(loadError?.message || "Failed to load checks");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadChecks();
  }, [searchParams]);

  const allServices = useMemo<ServiceOption[]>(
    () => projects.flatMap((p) => (p.services || []).map((s) => ({ ...s, project: { id: p.id, name: p.name } }))),
    [projects]
  );

  const serviceById = useMemo(() => new Map(allServices.map((service) => [service.id, service])), [allServices]);
  const selectedService = form.serviceId ? serviceById.get(form.serviceId) ?? null : null;

  const detectIpVersion = (host: string): 0 | 4 | 6 => {
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return 4;
    if (host.includes(":")) return 6;
    return 0;
  };

  const isPrivateDevHost = (hostname: string): boolean => {
    const host = hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
    if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) return true;
    const ipVersion = detectIpVersion(host);
    if (ipVersion === 4) {
      const parts = host.split(".").map((value) => Number.parseInt(value, 10));
      if (parts.length !== 4 || parts.some((value) => Number.isNaN(value))) return true;
      const a = parts[0]!;
      const b = parts[1]!;
      if (a === 10 || a === 127 || a === 0) return true;
      if (a === 192 && b === 168) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 169 && b === 254) return true;
    }
    if (ipVersion === 6) {
      if (host === "::1") return true;
      if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return true;
    }
    return false;
  };

  const sslValidationError = useMemo(() => {
    if (form.type !== "SSL") return null;
    if (!selectedService) return "Choose a service before creating an SSL check.";
    const target = selectedService.baseUrl;
    if (!target) return "SSL checks require a service target URL.";
    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      return "SSL checks require a valid URL target.";
    }
    if (parsed.protocol !== "https:") return "SSL checks require an https:// target URL.";
    if (isPrivateDevHost(parsed.hostname)) return "SSL checks cannot target localhost or private/dev hosts.";
    return null;
  }, [form.type, selectedService]);

  const projectScopedServices = useMemo(() => {
    if (!projectIdFilter) return allServices;
    return allServices.filter((service) => service.project.id === projectIdFilter);
  }, [allServices, projectIdFilter]);

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.serviceId) {
      setError("Please select a service");
      return;
    }
    if (sslValidationError) {
      setError(sslValidationError);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        type: form.type,
        intervalSeconds: form.intervalSeconds,
        timeoutMs: form.timeoutMs,
        failureThreshold: form.failureThreshold,
        recoveryThreshold: form.recoveryThreshold
      };

      if (form.type === "HTTP") {
        body.expectedStatusCode = form.expectedStatusCode;
      }
      if (form.type === "KEYWORD") {
        body.expectedKeyword = form.expectedKeyword;
        body.expectedStatusCode = form.expectedStatusCode;
      }
      if (form.type === "RESPONSE_TIME") {
        body.configJson = { maxResponseTimeMs: form.maxResponseTimeMs };
      }

      await apiFetch(`/services/${form.serviceId}/checks`, {
        method: "POST",
        body: JSON.stringify(body)
      });

      setForm(EMPTY_FORM);
      setShowForm(false);
      await loadChecks();
    } catch (submitError: any) {
      setError(submitError?.message || "Failed to create check");
    } finally {
      setSaving(false);
    }
  };

  const toggleCheck = async (check: CheckRow) => {
    try {
      await apiFetch(`/services/${check.service.id}/checks/${check.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !check.isActive })
      });
      await loadChecks();
    } catch (err: any) {
      setError(err?.message || "Failed to update check");
    }
  };

  // Prefer server summary when available (contains the pre-filtered counts).
  // Fall back to a client-computed summary when the server hasn't responded yet.
  const summary = useMemo(() => {
    if (serverSummary) {
      return {
        total: serverSummary.total,
        passing: serverSummary.pass,
        failing: serverSummary.fail,
        warning: serverSummary.warn
      };
    }
    const total = checks.length;
    const passing = checks.filter((row) => row.latestResult?.status === "PASS").length;
    const failing = checks.filter((row) => row.latestResult?.status === "FAIL").length;
    const warning = checks.filter((row) => row.latestResult?.status === "WARN").length;
    return { total, passing, failing, warning };
  }, [checks, serverSummary]);

  // Server now handles status/project/service filtering; only PENDING needs local fallback
  const filteredChecks = checks.filter((row) => {
    if (latestStatusFilter === "PENDING") {
      return (row.latestResult === null || row.latestResult.status === "PENDING");
    }
    return true;
  });

  const displayChecks = [...filteredChecks].sort((a, b) => {
    const rank = (status: string) => {
      if (status === "FAIL") return 0;
      if (status === "WARN") return 1;
      if (status === "PENDING") return 2;
      return 3;
    };
    const statusA = a.latestResult?.status ?? "PENDING";
    const statusB = b.latestResult?.status ?? "PENDING";
    const byStatus = rank(statusA) - rank(statusB);
    if (byStatus !== 0) return byStatus;
    const aTime = a.latestResult ? new Date(a.latestResult.checkedAt).getTime() : 0;
    const bTime = b.latestResult ? new Date(b.latestResult.checkedAt).getTime() : 0;
    return bTime - aTime;
  });

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (!value) {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    router.push(`/checks?${next.toString()}`);
  };

  const summarizeMessage = (status: string, message: string | null): { summary: string; raw?: string } => {
    if (!message) return { summary: "-" };
    const lower = message.toLowerCase();
    if ((status === "FAIL" || status === "WARN") && (lower.includes("ssl") || lower.includes("tls") || lower.includes("openssl"))) {
      return {
        summary: "TLS handshake failed during SSL validation",
        raw: message
      };
    }
    return { summary: message };
  };

  return (
    <Shell>
      <Header title="Checks" />
      <section className="three-col">
        <StatCard label="Total checks" value={loading ? "-" : summary.total} href="/checks" />
        <StatCard label="Passing" value={loading ? "-" : summary.passing} href="/checks?latestStatus=PASS" />
        <StatCard label="Failing" value={loading ? "-" : summary.failing} href="/checks?latestStatus=FAIL" />
        <StatCard label="Warnings" value={loading ? "-" : summary.warning} href="/checks?latestStatus=WARN" />
        <StatCard label="Pending" value={loading ? "-" : (serverSummary?.pending ?? checks.filter((row) => row.latestResult === null || row.latestResult.status === "PENDING").length)} href="/checks?latestStatus=PENDING" />
      </section>

      <section className="panel">
        <div className="section-head" style={{ marginBottom: "10px" }}>
          <FilterPresets basePath="/checks" presets={CHECKS_PRESETS} currentParams={searchParams.toString()} />
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <CopyFilterLink />
            {searchParams.toString() ? (
              <Link href="/checks" className="secondary-button">Clear filters</Link>
            ) : null}
          </div>
        </div>
        <div className="form-row">
          <label>
            Latest status
            <select value={latestStatusFilter} onChange={(event) => setFilter("latestStatus", event.target.value)}>
              <option value="">All</option>
              <option value="PASS">PASS</option>
              <option value="FAIL">FAIL</option>
              <option value="WARN">WARN</option>
              <option value="PENDING">PENDING</option>
            </select>
          </label>
          <label>
            Project
            <select value={projectIdFilter} onChange={(event) => {
              const next = new URLSearchParams(searchParams.toString());
              if (!event.target.value) {
                next.delete("projectId");
              } else {
                next.set("projectId", event.target.value);
              }
              next.delete("serviceId");
              router.push(`/checks?${next.toString()}`);
            }}>
              <option value="">All</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="form-row" style={{ marginTop: "10px" }}>
          <label>
            Service
            <select value={serviceIdFilter} onChange={(event) => setFilter("serviceId", event.target.value)}>
              <option value="">All</option>
              {projectScopedServices.map((service) => (
                <option key={service.id} value={service.id}>{service.project.name} - {service.name}</option>
              ))}
            </select>
          </label>
          <label>
            Active state
            <select value={isActiveFilter} onChange={(event) => setFilter("isActive", event.target.value)}>
              <option value="">All</option>
              <option value="true">Active</option>
              <option value="false">Paused</option>
            </select>
          </label>
        </div>
        <div className="form-row" style={{ marginTop: "10px" }}>
          <label>
            Updated from
            <input
              type="datetime-local"
              value={searchParams.get("dateFrom") || ""}
              onChange={(e) => setFilter("dateFrom", e.target.value)}
            />
          </label>
          <label>
            Updated to
            <input
              type="datetime-local"
              value={searchParams.get("dateTo") || ""}
              onChange={(e) => setFilter("dateTo", e.target.value)}
            />
          </label>
        </div>
      </section>

      {error ? <section className="panel error-panel">{error}</section> : null}

      {showForm ? (
        <section className="panel">
          <div className="section-head">
            <div>
              <h2>Create check</h2>
              <p>Add a new monitoring check to a service.</p>
            </div>
            <button className="secondary-button" onClick={() => setShowForm(false)} data-action="local-ui">Cancel</button>
          </div>
          <form className="stack-form" onSubmit={(e) => void handleCreate(e)}>
            <label>
              Service
              <select
                value={form.serviceId}
                onChange={(e) => setForm((f) => ({ ...f, serviceId: e.target.value }))}
                required
              >
                <option value="">Select a service…</option>
                {allServices.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.project.name} — {s.name}
                  </option>
                ))}
              </select>
            </label>
            {selectedService ? (
              <p className="table-subtle">Target URL: {selectedService.baseUrl || "No URL configured"}</p>
            ) : null}
            <label>
              Name
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
                placeholder="e.g. Homepage HTTP 200"
              />
            </label>
            <label>
              Check type
              <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
                <option value="HTTP">HTTP — status code</option>
                <option value="SSL">SSL — certificate expiry</option>
                <option value="KEYWORD">Keyword — body contains string</option>
                <option value="RESPONSE_TIME">Response time — latency threshold</option>
              </select>
            </label>
            {form.type === "HTTP" || form.type === "KEYWORD" ? (
              <label>
                Expected status code
                <input
                  type="number"
                  value={form.expectedStatusCode}
                  onChange={(e) => setForm((f) => ({ ...f, expectedStatusCode: Number(e.target.value) }))}
                />
              </label>
            ) : null}
            {form.type === "KEYWORD" ? (
              <label>
                Keyword to find
                <input
                  value={form.expectedKeyword}
                  onChange={(e) => setForm((f) => ({ ...f, expectedKeyword: e.target.value }))}
                  placeholder="e.g. healthy"
                  required
                />
              </label>
            ) : null}
            {form.type === "RESPONSE_TIME" ? (
              <label>
                Max response time (ms)
                <input
                  type="number"
                  value={form.maxResponseTimeMs}
                  onChange={(e) => setForm((f) => ({ ...f, maxResponseTimeMs: Number(e.target.value) }))}
                />
              </label>
            ) : null}
            {form.type === "SSL" ? (
              <p className={sslValidationError ? "error-chip" : "table-subtle"}>
                {sslValidationError || "SSL target is valid for certificate monitoring."}
              </p>
            ) : null}
            <label>
              Interval (seconds)
              <input
                type="number"
                value={form.intervalSeconds}
                onChange={(e) => setForm((f) => ({ ...f, intervalSeconds: Number(e.target.value) }))}
              />
            </label>
            <label>
              Timeout (ms)
              <input
                type="number"
                value={form.timeoutMs}
                onChange={(e) => setForm((f) => ({ ...f, timeoutMs: Number(e.target.value) }))}
              />
            </label>
            <div className="form-row">
              <label>
                Failure threshold
                <input
                  type="number"
                  value={form.failureThreshold}
                  onChange={(e) => setForm((f) => ({ ...f, failureThreshold: Number(e.target.value) }))}
                />
              </label>
              <label>
                Recovery threshold
                <input
                  type="number"
                  value={form.recoveryThreshold}
                  onChange={(e) => setForm((f) => ({ ...f, recoveryThreshold: Number(e.target.value) }))}
                />
              </label>
            </div>
            <button type="submit" disabled={saving || Boolean(sslValidationError)} data-action="api" data-endpoint="/services/:serviceId/checks">{saving ? "Creating…" : "Create check"}</button>
          </form>
        </section>
      ) : null}

      <section className="panel">
        <div className="section-head">
          <div>
            <h2>Check inventory</h2>
            <p>Failing checks are listed first, followed by warnings, pending checks, and passing checks.</p>
          </div>
          {!showForm ? (
            <button className="primary-button" onClick={() => setShowForm(true)} data-action="local-ui">+ Add check</button>
          ) : null}
        </div>

        {loading ? (
          <p>Loading checks...</p>
        ) : displayChecks.length === 0 ? (
          <p>No checks match current filters. Try broadening status, service, or date filters.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Check</th>
                <th>Project</th>
                <th>Service</th>
                <th>Type</th>
                <th>Latest status</th>
                <th>Latency</th>
                <th>Last run</th>
                <th>Next run</th>
                <th>Message</th>
                <th>Active</th>
              </tr>
            </thead>
            <tbody>
              {displayChecks.map((row) => {
                const latestStatus = row.latestResult?.status || "PENDING";
                const message = summarizeMessage(latestStatus, row.latestResult?.message || null);
                return (
                <tr key={row.id}>
                  <td>
                    <strong><Link href={`/checks/${row.id}`}>{row.name}</Link></strong>
                    <div className="table-subtle">
                      every {row.intervalSeconds}s, timeout {row.timeoutMs}ms
                    </div>
                  </td>
                  <td><Link href={`/projects/${row.service.project.id}`}>{row.service.project.name}</Link></td>
                  <td>
                    <Link href={`/checks?serviceId=${row.service.id}`}>{row.service.name}</Link>
                    <div className="table-subtle">{serviceById.get(row.service.id)?.baseUrl || "No target URL"}</div>
                  </td>
                  <td>{row.type}</td>
                  <td>
                    <Link href={`/checks?latestStatus=${latestStatus}`} className={`result-pill ${latestStatus.toLowerCase()}`}>
                      {latestStatus}
                    </Link>
                  </td>
                  <td>{row.latestResult?.responseTimeMs ? `${row.latestResult.responseTimeMs} ms` : "-"}</td>
                  <td>{row.latestResult ? new Date(row.latestResult.checkedAt).toLocaleString() : "-"}</td>
                  <td>
                    {row.latestResult
                      ? new Date(new Date(row.latestResult.checkedAt).getTime() + row.intervalSeconds * 1000).toLocaleString()
                      : "-"}
                  </td>
                  <td>
                    <div>{message.summary}</div>
                    {message.raw && (latestStatus === "FAIL" || latestStatus === "WARN") ? (
                      <details>
                        <summary className="table-subtle">Show raw SSL error</summary>
                        <pre>{message.raw}</pre>
                      </details>
                    ) : null}
                  </td>
                  <td>
                    <button
                      className={row.isActive ? "secondary-button" : "primary-button"}
                      data-action="api"
                      data-endpoint="/services/:serviceId/checks/:checkId"
                      onClick={() => void toggleCheck(row)}
                    >
                      {row.isActive ? "Pause" : "Resume"}
                    </button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </Shell>
  );
}

export default function ChecksPage() {
  return (
    <Suspense fallback={<Shell><Header title="Checks" /><section className="panel">Loading checks...</section></Shell>}>
      <ChecksPageContent />
    </Suspense>
  );
}
