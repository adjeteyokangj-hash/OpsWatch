import fs from "fs";
import path from "path";
import http from "http";

const requireEnv = (key: string): string => {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
};

const portRaw = requireEnv("NOTIFY_WEBHOOK_PORT");
const port = Number(portRaw);
if (!Number.isFinite(port) || port <= 0) {
  throw new Error(`NOTIFY_WEBHOOK_PORT must be a positive number; received '${portRaw}'`);
}

const outputPath = requireEnv("NOTIFY_WEBHOOK_OUTPUT");

fs.mkdirSync(path.dirname(outputPath), { recursive: true });

const server = http.createServer((req, res) => {
  if (req.method !== "POST") {
    res.statusCode = 404;
    res.end("Not found");
    return;
  }

  let body = "";
  req.on("data", (chunk) => {
    body += chunk.toString();
  });

  req.on("end", () => {
    let parsedBody: unknown = body;
    try {
      parsedBody = body ? JSON.parse(body) : null;
    } catch {
      parsedBody = body;
    }

    const line = JSON.stringify({
      receivedAt: new Date().toISOString(),
      method: req.method,
      url: req.url,
      body: parsedBody
    });
    fs.appendFileSync(outputPath, `${line}\n`, "utf8");
    console.log("WEBHOOK_RECEIVED", line);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  });
});

server.listen(port, () => {
  console.log(`WEBHOOK_LISTENER_READY port=${port} output=${outputPath}`);
});
