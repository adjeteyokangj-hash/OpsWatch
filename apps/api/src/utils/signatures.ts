import { createHmac } from "crypto";

export const createSignature = (payload: unknown, timestamp: string, secret: string): string => {
  const body = JSON.stringify(payload);
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
};

export const safeCompare = (left: string, right: string): boolean => {
  return left.length === right.length && left === right;
};
