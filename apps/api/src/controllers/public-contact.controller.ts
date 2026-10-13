import type { Request, Response } from "express";
import { logger } from "../config/logger";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const publicContactController = async (req: Request, res: Response): Promise<void> => {
  const name = String(req.body?.name ?? "").trim();
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const company = String(req.body?.company ?? "").trim();
  const message = String(req.body?.message ?? "").trim();
  const topic = String(req.body?.topic ?? "").trim();

  if (!name || name.length > 120) {
    res.status(400).json({ ok: false, error: "Please provide your full name." });
    return;
  }

  if (!email || email.length > 200 || !EMAIL_RE.test(email)) {
    res.status(400).json({ ok: false, error: "Please provide a valid work email." });
    return;
  }

  if (!message || message.length < 10 || message.length > 4000) {
    res.status(400).json({ ok: false, error: "Please include a message of at least 10 characters." });
    return;
  }

  if (company.length > 160) {
    res.status(400).json({ ok: false, error: "Company name is too long." });
    return;
  }

  logger.info("Public contact enquiry accepted", {
    name,
    email,
    company: company || null,
    topic: topic || null,
    messageLength: message.length
  });

  res.status(200).json({
    ok: true,
    delivery: "logged",
    message:
      "Thanks. Your message was received and logged for the OpsWatch team. We will respond by email."
  });
};
