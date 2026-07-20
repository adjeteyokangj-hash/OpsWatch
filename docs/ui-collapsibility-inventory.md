# OpsWatch big-card collapsibility inventory

Date: 2026-07-20  
Scope: local UI consistency pass after Phases 1–10  
Nothing pushed or deployed.

## Shared component

- `apps/web/src/components/ui/page-section.tsx` — single disclosure primitive
- Chevron + clickable header (`button.page-section-summary`)
- `aria-expanded` / `aria-controls`
- Stable `persistKey` → `localStorage` key `opswatch:page-section:<persistKey>`
- Children stay mounted while collapsed (forms retain values)
- Header `actions` render outside the toggle control
- `collapsible={false}` for justified static panels

## Audited routes (customer-facing)

| Route | Large cards | Converted / keyed | Exceptions |
|---|---|---|---|
| `/dashboard` | Health, credibility, ops, recommendations, tables | Yes (`org:dashboard:*`) | KPI stat cards |
| `/intelligence` | 13 learning/prediction panels | Yes (`org:intelligence:*`) | Banners / loading |
| `/automation` | Filters, approvals, runs | Yes | — |
| `/automation/playbooks` | Playbook cards | Already keyed | — |
| `/alerts` | Filters + list | Already keyed | — |
| `/alerts/[alertId]` | Details + automation | Yes | KPI strip |
| `/incidents` | Filters + list | Already keyed | — |
| `/incidents/[incidentId]` | Overview/timeline/graph/automation panels | Yes (`incident:{id}:*`) | Meta strip, tab nav, emergency chrome, canvas |
| `/connections` | Registry, wizard, related | Yes (`org:connections:*`) | Error banners |
| `/settings` | Notification channels | Yes | Pill nav |
| `/settings/maintenance` | Schedule + windows | Already keyed | Pill nav |
| `/org` | Details, status pages, API keys/usage | Yes | Modals |
| `/members` | Member tables + create/reset forms | Yes | Pill nav, warnings |
| `/checks` | Filters, create, inventory | Yes | — |
| `/checks/[checkId]` | Config, exceptions, history, links | Yes | Loading shells |
| `/security` | Coverage, findings, sequences, controls | Yes | Workspace intro banner |
| `/insights` | 11 intelligence panels | Yes | KPI strip |
| `/accuracy` (+ actions) | Accuracy tables/detail | Yes / already keyed | KPI strip, pill nav |
| `/analytics/operations` | Analytics panels | Yes | Pill nav |
| `/subscription` | Plan/usage/plans | Yes | Notices |
| `/onboarding` | Steps | Yes (progress `collapsible={false}`) | — |
| `/workflows`, `/services` | Inventories | Yes | — |
| `/projects` | Search/filters/applications | Yes | Empty-state CTA, register modal |
| `/projects/[id]` overview | Snapshot, links, feeds, connections | Yes | KPI strip |
| `/projects/[id]/topology` | Live info, key, list, memory | Yes | Canvas, nav, drawers, banners, empty CTA |
| `/projects/[id]/{alerts,incidents,automation,settings,contacts,policies,reliability,billing,insights,metrics,deployments,activity,log-streams,performance,checks,monitored-areas,integrations}` | Workspace panels | Yes / keyed | Stats, empty CTAs |
| `/integrations` (+ project/provider) | Registry / dashboards | Yes | KPI overview strip |
| `/admin/billing/stripe` | Admin panels | Yes | Validation banners |
| `/reports` | Hub link cards only | **Exception** — navigation hub, not data panels | Hub cards |
| `/login`, `/register` | Auth forms | **Exception** | Auth |
| `/status`, `/auto-run-policy`, `/status-page/[id]` | Status/policy panels | Keyed / converted | Banners |

## Justified non-collapsible exceptions

- Page titles and primary navigation
- Critical warning/error/success banners
- Active incident meta strip and tab navigation
- Confirmation dialogs / modal overlays / topology drawers
- Small KPI/stat cards and compact action cards
- Login/registration forms
- Empty-state cards whose only content is the page primary CTA
- Topology canvas (primary interactive surface)
- Reports hub link grid

## Tests

| Gate | Result |
|---|---|
| Web typecheck | exit 0 |
| PageSection unit tests | expand/collapse, persist, keyboard, actions isolation, multi-card, dynamic keys, form retention |
| Web unit suite | 146+ passed (pre-rebuild); PageSection + topology-key re-verified after button migration |
| Web production build | exit 0 (clean `NODE_ENV`) |
| Playwright `e2e/page-section-collapsibility.spec.ts` | **1 passed** (exit 0); evidence under `test-artifacts/ui-collapsibility/` |

## Screenshot evidence

Directory: `test-artifacts/ui-collapsibility/`

- Dashboard / projects / alerts / incidents / automation / connections / settings / security / org / intelligence — expanded + collapsed
- Project overview + topology when apps exist
- Settings persistence after reload
- Mobile dashboard + tablet connections

## Verdict

**Local collapsibility pass complete.** Playwright exit 0 with route screenshots. Ready for inclusion in the next controlled push review. Do not push until explicitly approved.