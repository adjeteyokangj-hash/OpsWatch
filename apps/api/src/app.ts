import "express-async-errors";
import express from "express";
import type { Request } from "express";
import { RawBodyRequest } from "./lib/request-signature";
import { WebhookRequest } from "./middleware/webhook-auth";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { API_PREFIX } from "./config/constants";
import { requestId } from "./middleware/request-id";
import { rateLimit } from "./middleware/rate-limit";
import { errorHandler } from "./middleware/error-handler";
import { requireAuth } from "./middleware/auth";

import { healthRouter } from "./routes/health.routes";
import { authRouter } from "./routes/auth.routes";
import { projectsRouter } from "./routes/projects.routes";
import { servicesRouter } from "./routes/services.routes";
import { checksRouter } from "./routes/checks.routes";
import { alertsRouter } from "./routes/alerts.routes";
import { incidentsRouter } from "./routes/incidents.routes";
import { statusRouter } from "./routes/status.routes";
import { settingsRouter } from "./routes/settings.routes";
import { aiAutomationPoliciesRouter } from "./routes/ai-automation-policies.routes";
import { productInsightsRouter } from "./routes/product-insights.routes";
import remediationRouter from "./routes/remediation.routes";
import { ensureRemediationProvidersRegistered } from "./services/remediation/providers/register-providers";
import { usersRouter } from "./routes/users.routes";
import { billingRouter } from "./routes/billing.routes";
import { subscriptionRouter } from "./routes/subscription.routes";
import { orgRouter } from "./routes/org.routes";
import { onboardingRouter } from "./routes/onboarding.routes";
import { trueNumerisRouter } from "./routes/truenumeris.routes";
import { eventsRouter } from "./routes/events.routes";
import { heartbeatsRouter } from "./routes/heartbeats.routes";
import analyticsRouter from "./routes/analytics.routes";
import maintenanceWindowsRouter from "./routes/maintenance-windows.routes";
import automationRouter from "./routes/automation.routes";
import intelligenceRouter from "./routes/intelligence.routes";
import { internalRouter } from "./routes/internal.routes";
import { webhooksRouter } from "./routes/webhooks.routes";
import { adminBillingRouter } from "./routes/admin-billing.routes";
import { connectionsRouter } from "./routes/connections.routes";
import { connectionIngestRouter } from "./routes/connection-ingest.routes";
import { logsApmRouter } from "./routes/logs-apm.routes";
import { securityRouter } from "./routes/security.routes";

const webhookJsonParser = express.json({
  limit: "1mb",
  verify: (req, _res, buf) => {
    (req as WebhookRequest).rawBody = buf;
  }
});

export const app = express();

const allowedWebOrigins = Array.from(new Set([
  process.env.OPSWATCH_WEB_URL,
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "http://127.0.0.1:3002",
  "https://ops-watch-web.vercel.app",
  "https://opswatch.okanggroup.com"
].filter((origin): origin is string => Boolean(origin))));

const isDevLocalOrigin = (origin: string): boolean =>
  process.env.NODE_ENV !== "production" &&
  /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedWebOrigins.includes(origin) || isDevLocalOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true
  })
);
app.use(helmet());
app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      (req as Request & RawBodyRequest).rawBody = buf;
    }
  })
);
app.use(morgan("dev"));
app.use(requestId);
app.use(rateLimit);

app.use(API_PREFIX, healthRouter);
app.use(healthRouter);
app.use(API_PREFIX, authRouter);
app.use(API_PREFIX, statusRouter);
app.use(API_PREFIX, trueNumerisRouter);
app.use(API_PREFIX, eventsRouter);
app.use(API_PREFIX, securityRouter);
app.use(API_PREFIX, heartbeatsRouter);
app.use(`${API_PREFIX}/webhooks`, webhookJsonParser, webhooksRouter);
app.use(API_PREFIX, connectionIngestRouter);
app.use(API_PREFIX, internalRouter);

app.use(API_PREFIX, requireAuth, projectsRouter);
app.use(API_PREFIX, requireAuth, servicesRouter);
app.use(API_PREFIX, requireAuth, checksRouter);
app.use(API_PREFIX, requireAuth, alertsRouter);
app.use(API_PREFIX, requireAuth, incidentsRouter);
app.use(API_PREFIX, requireAuth, settingsRouter);
app.use(API_PREFIX, requireAuth, aiAutomationPoliciesRouter);
app.use(API_PREFIX, requireAuth, productInsightsRouter);
app.use(API_PREFIX, requireAuth, usersRouter);
app.use(API_PREFIX, requireAuth, billingRouter);
app.use(API_PREFIX, requireAuth, subscriptionRouter);
app.use(API_PREFIX, requireAuth, adminBillingRouter);
app.use(API_PREFIX, requireAuth, orgRouter);
app.use(API_PREFIX, requireAuth, onboardingRouter);
app.use(API_PREFIX, requireAuth, analyticsRouter);
app.use(API_PREFIX, requireAuth, maintenanceWindowsRouter);
app.use(API_PREFIX, requireAuth, automationRouter);
app.use(API_PREFIX, requireAuth, intelligenceRouter);
app.use(API_PREFIX, requireAuth, connectionsRouter);
  app.use(API_PREFIX, requireAuth, logsApmRouter);
  app.use(`${API_PREFIX}/remediation`, requireAuth, remediationRouter);

ensureRemediationProvidersRegistered();

app.use(errorHandler);
