import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config/env", () => ({
  env: {
    smtpHost: process.env.SMTP_HOST,
    smtpPort: Number(process.env.SMTP_PORT),
    smtpUser: process.env.SMTP_USER,
    smtpPass: process.env.SMTP_PASS,
    smtpFrom: process.env.SMTP_FROM
  }
}));
vi.mock("../../config/logger", () => ({ logger: { warn: vi.fn() } }));

const sockets = new Set<net.Socket>();
let server: net.Server | null = null;

afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  server = null;
  vi.unstubAllEnvs();
  vi.resetModules();
});

// A loopback-only SMTP sink validates the actual mailer without sending email.
async function smtpSink() {
  const messages: string[] = [];
  const commands: string[] = [];
  server = net.createServer(socket => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.write("220 localhost ESMTP test\r\n");
    let buffered = "";
    let dataMode = false;
    let loginStep = 0;
    socket.on("data", chunk => {
      buffered += chunk.toString();
      while (true) {
        if (dataMode) {
          const end = buffered.indexOf("\r\n.\r\n");
          if (end < 0) return;
          messages.push(buffered.slice(0, end));
          buffered = buffered.slice(end + 5);
          dataMode = false;
          socket.write("250 2.0.0 queued locally\r\n");
          continue;
        }
        const end = buffered.indexOf("\r\n");
        if (end < 0) return;
        const line = buffered.slice(0, end);
        buffered = buffered.slice(end + 2);
        if (loginStep) {
          socket.write(loginStep === 1 ? "334 UGFzc3dvcmQ6\r\n" : "235 authenticated\r\n");
          loginStep = loginStep === 1 ? 2 : 0;
        } else if (/^(EHLO|HELO)/i.test(line)) {
          socket.write("250-localhost\r\n250-AUTH PLAIN LOGIN\r\n250 SIZE 1048576\r\n");
        } else if (/^AUTH LOGIN/i.test(line)) {
          loginStep = 1;
          socket.write("334 VXNlcm5hbWU6\r\n");
        } else if (/^AUTH /i.test(line)) socket.write("235 authenticated\r\n");
        else if (/^DATA$/i.test(line)) {
          dataMode = true;
          socket.write("354 end with dot\r\n");
        } else if (/^QUIT$/i.test(line)) socket.end("221 bye\r\n");
        else {
          commands.push(line);
          socket.write("250 ok\r\n");
        }
      }
    });
  });
  await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  vi.stubEnv("SMTP_HOST", "127.0.0.1");
  vi.stubEnv("SMTP_PORT", String(port));
  vi.stubEnv("SMTP_USER", "local-test");
  vi.stubEnv("SMTP_PASS", "local-test");
  vi.stubEnv("SMTP_FROM", "alerts@opswatch.test");
  return { messages, commands };
}

describe("patched Nodemailer compatibility", () => {
  it.each(["api", "worker"])("delivers the %s alert through standard authenticated SMTP", async component => {
    vi.resetModules();
    const sink = await smtpSink();
    const { sendEmailAlert } = component === "api"
      ? await import("./email-alert.service")
      : await import("../../../../worker/src/services/notifications/email-alert.service");
    await sendEmailAlert(
      { target: "operator@opswatch.test" } as never,
      {
        Project: { name: "NiiNai" }, Service: { name: "API" }, severity: "CRITICAL",
        status: "OPEN", title: "Connectivity alert", message: "Connection unavailable",
        lastSeenAt: new Date("2026-10-19T00:00:00Z")
      } as never,
      "New alert"
    );
    expect(sink.commands.some(line => /^MAIL FROM:<alerts@opswatch.test>/i.test(line))).toBe(true);
    expect(sink.commands.some(line => /^RCPT TO:<operator@opswatch.test>/i.test(line))).toBe(true);
    expect(sink.messages).toHaveLength(1);
    expect(sink.messages[0]).toContain("[OpsWatch] NiiNai CRITICAL Connectivity alert");
    expect(sink.messages[0]).toContain("Connection unavailable");
  }, 15000);
});
