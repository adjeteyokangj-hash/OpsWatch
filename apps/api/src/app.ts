import "express-async-errors";
import express from "express";
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
import { productInsightsRouter } from "./routes/product-insights.routes";
import remediationRouter from "./routes/remediation.routes";
import { usersRouter } from "./routes/users.routes";
import { billingRouter } from "./routes/billing.routes";
import { orgRouter } from "./routes/org.routes";
import { onboardingRouter } from "./routes/onboarding.routes";
import { trueNumerisRouter } from "./routes/truenumeris.routes";

export const app = express();

app.use(
  cors({
    origin: ["http://localhost:3000", "https://ops-watch-web.vercel.app"],
    credentials: true
  })
);
app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));
app.use(requestId);
app.use(rateLimit);

app.use(API_PREFIX, healthRouter);
app.use(healthRouter);
app.use(API_PREFIX, authRouter);
app.use(API_PREFIX, statusRouter);
app.use(API_PREFIX, trueNumerisRouter);

app.use(API_PREFIX, requireAuth, projectsRouter);
app.use(API_PREFIX, requireAuth, servicesRouter);
app.use(API_PREFIX, requireAuth, checksRouter);
app.use(API_PREFIX, requireAuth, alertsRouter);
app.use(API_PREFIX, requireAuth, incidentsRouter);
app.use(API_PREFIX, requireAuth, settingsRouter);
app.use(API_PREFIX, requireAuth, productInsightsRouter);
app.use(API_PREFIX, requireAuth, usersRouter);
app.use(API_PREFIX, requireAuth, billingRouter);
app.use(API_PREFIX, requireAuth, orgRouter);
app.use(API_PREFIX, requireAuth, onboardingRouter);
app.use(`${API_PREFIX}/remediation`, requireAuth, remediationRouter);

app.use(errorHandler);
