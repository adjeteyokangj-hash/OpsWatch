# OpsWatch × OkangGroup CMS — Phase 1 implementation notes

## OpsWatch surface

| Path | Auth | Purpose |
|------|------|---------|
| `GET /api/cms/health` | none | Gateway health |
| `GET /api/cms/v1/published` | none | Public published modules for website |
| `GET /api/cms/v1/capabilities` | `X-Api-Key` | Module catalogue |
| `GET/PUT /api/cms/v1/modules/:code/content` | `X-Api-Key` | Draft get/put |
| `POST /api/cms/v1/modules/:code/publish` | `X-Api-Key` | Publish draft |
| `POST /api/cms/v1/modules/:code/rollback` | `X-Api-Key` | Restore published revision |
| `POST /api/cms/v1/preview-token` | `X-Api-Key` | Signed preview token |
| `GET /api/cms/v1/preview?token=` | preview token | Draft snapshot for Owner preview |

Env: `OPSWATCH_CMS_API_KEY`, optional `OPSWATCH_CMS_PREVIEW_SECRET`.

Additive tables: `MarketingContentDocument`, `MarketingContentRevision`, `MarketingCmsApiKey`.

## Content contract

Frozen in [`apps/web/src/content/marketing/contract.ts`](../apps/web/src/content/marketing/contract.ts).

Website reads prefer published modules via `resolveMarketingContent()`, then local seed.

## OkangGroup

See `OKANGGROUP/docs/architecture/opswatch-managed-website-registration.md`.

Adapter code: `opswatch_marketing`.
