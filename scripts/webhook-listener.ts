import fs from "fs";
import path from "path";
import http from "http";

const port = Number(process.env.NOTIFY_WEBHOOK_PORT || 4011);
const outputPath = process.env.NOTIFY_WEBHOOK_OUTPUT || path.join(process.cwd(), "tmp", "notification-events.jsonl");

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
