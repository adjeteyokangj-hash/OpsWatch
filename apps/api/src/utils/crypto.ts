import { createHash, randomBytes } from "crypto";

export const generateApiKey = (): string => randomBytes(16).toString("hex");
export const generateSigningSecret = (): string => randomBytes(32).toString("hex");

export const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
