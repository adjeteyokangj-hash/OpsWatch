# Integrated OpsWatch release contract

Issue #17. One branch, one review, one production release. Do not claim a feature complete based only on a green build.

## Delivery gates

1. AI Operations Centre: one navigable workspace and project context, explicit configuration/runtime/evidence states, overdue worker jobs with last successful run and error, diagnosis separate from prediction and automation, human approval and verified outcomes. No hidden status substitution.
2. Canonical topology: use OperationalEntity/OperationalRelationship as authoritative with explicit legacy compatibility, reconcile visible nodes and counters from the same scoped graph, no invented locations or relationships, preserve NiiNai property grouping and shared services. OkangGroup public and admin endpoint nodes must be counted truthfully. Oware World must not inherit unrelated modules.
3. Catalogue: extensible core module definitions, per-project applicability and assignment evidence, AI proposes from supplied description, public URL and authorised API metadata. States: verified, inferred, suggested, rejected. Proposal does not create healthy live service; owner approval required for materialisation. Support additional custom modules without global contamination.
4. Insights: coverage counts only active monitoring evidence, tracked gaps stay gaps. Approval requirements and test-mode boundaries remain enforced.
5. Verification: tenant isolation, empty/stale/partial data, idempotent discovery, duplicate sources, confidence and expiry, worker failure vs diagnosis, project-specific catalogue, API and web tests, CI, production smoke across NiiNai/OkangGroup/Oware World.

## Safety and rollout

No DB reset or migration reset. Additive schema only if needed, after review and backup. Do not delete evidence. No automatic high-impact remediation. No fabricated health. Observe-only NiiNai heartbeats retain the existing 10-minute offline threshold. Deploy only once after all gates are satisfied.

## Known evidence to resolve

Intelligence screenshot: 95 observations, legacy 0/0, recent Phase 9 ready 8/42, 17 open anomalies, zero candidates and memories; worker active but overdue jobs and no AI decision. OkangGroup topology screenshot: public website and admin endpoint visible while module/relationship summary says zero; AI operations status unavailable. Insights screenshot: coverage 7% overall, 0% in opened project, and tracked gap actions that do not create live monitoring.

## Release evidence

Record code paths changed, schema effects, CI run URL, per-project before/after verification, production commit and smoke results in this document before closing #17.
