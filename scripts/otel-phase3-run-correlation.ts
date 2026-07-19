import path from "path";
import { config } from "dotenv";

config({ path: path.resolve(process.cwd(), "apps/api/.env") });
config({ path: path.resolve(process.cwd(), "apps/worker/.env") });
process.env.OPSWATCH_OTEL_INCIDENT_CORRELATION_ENABLED = "true";

async function main() {
  const { runIncidentCorrelationJob } = await import(
    "../apps/worker/src/jobs/run-incident-correlation.job"
  );
  await runIncidentCorrelationJob();
  console.log("correlation-complete");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
