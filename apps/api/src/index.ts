import { app } from "./app";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { prisma } from "./lib/prisma";

const server = app.listen(env.port, "0.0.0.0", () => {
  logger.info(`OpsWatch API listening on 0.0.0.0:${env.port}`);
});

server.on("error", (error) => {
  logger.error("HTTP server failed to start", error);
  process.exit(1);
});

const shutdown = async (signal: string) => {
  logger.info(`${signal} received — shutting down`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", reason);
});
process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception", error);
  process.exit(1);
});
