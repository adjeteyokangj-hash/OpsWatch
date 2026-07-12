import { execSync, spawn } from "node:child_process";
import net from "node:net";

const DEV_PORTS = [4000, 3000];

const log = (message) => console.log(`[dev] ${message}`);
const warn = (message) => console.warn(`[dev] WARNING: ${message}`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const canConnect = (host, port, timeoutMs = 1500) =>
  new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (value) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.on("connect", () => done(true));
    socket.on("timeout", () => done(false));
    socket.on("error", () => done(false));
  });

const listListeningPids = (port) => {
  if (process.platform === "win32") {
    try {
      const output = execSync(`netstat -ano -p tcp | findstr :${port}`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      });
      const pids = new Set();
      for (const line of output.split(/\r?\n/)) {
        if (!line.includes("LISTENING")) continue;
        const parts = line.trim().split(/\s+/);
        const pid = parts.at(-1);
        if (pid && /^\d+$/.test(pid) && pid !== "0") {
          pids.add(pid);
        }
      }
      return [...pids];
    } catch {
      return [];
    }
  }

  try {
    const output = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    return output
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
};

const killPid = (pid) => {
  try {
    if (process.platform === "win32") {
      execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" });
    } else {
      execSync(`kill -9 ${pid}`, { stdio: "ignore" });
    }
    return true;
  } catch {
    return false;
  }
};

const freePort = async (port) => {
  const pids = listListeningPids(port);
  if (pids.length === 0) {
    return;
  }

  log(`Freeing port ${port} (PID${pids.length === 1 ? "" : "s"}: ${pids.join(", ")})`);
  for (const pid of pids) {
    killPid(pid);
  }
  await sleep(800);
};

const readDatabaseHostPort = () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    return { host: "localhost", port: 5432 };
  }

  try {
    const parsed = new URL(url.replace(/^postgresql:\/\//, "http://"));
    return {
      host: parsed.hostname || "localhost",
      port: parsed.port ? Number(parsed.port) : 5432
    };
  } catch {
    return { host: "localhost", port: 5432 };
  }
};

const ensurePostgres = async () => {
  const { host, port } = readDatabaseHostPort();
  const reachable = await canConnect(host, port);
  if (reachable) {
    log(`PostgreSQL reachable at ${host}:${port}`);
    return;
  }

  warn(`PostgreSQL is not reachable at ${host}:${port}.`);
  warn("Start PostgreSQL before using the API/worker, or update DATABASE_URL in apps/api/.env and apps/worker/.env.");
  warn("Worker jobs will fail with P1001 until the database is running.");
};

const main = async () => {
  log("Preparing local dev environment…");

  for (const port of DEV_PORTS) {
    await freePort(port);
  }

  await ensurePostgres();

  log("Starting web, api, and worker…");
  const child = spawn("pnpm -r --parallel dev", {
    stdio: "inherit",
    shell: true,
    env: process.env
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
};

main().catch((error) => {
  console.error("[dev] Failed to start:", error);
  process.exit(1);
});
